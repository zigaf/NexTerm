package com.nexterm.ui

import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.nexterm.claude.*
import com.nexterm.model.ServerConnection
import com.nexterm.ssh.SSHTtyConnector
import kotlinx.coroutines.*
import java.awt.*
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import javax.swing.*

class ClaudeChatPanel(
    private val server: ServerConnection?,
    private val connector: SSHTtyConnector?,
) : JPanel(BorderLayout()) {

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // UI components
    private val messagesModel = DefaultListModel<ChatMessage>()
    private val messagesList = JBList(messagesModel)
    private val inputArea = JBTextArea(2, 40)
    private val sendButton = JButton("Send")
    private val modelSelector = JComboBox(ClaudeModel.entries.toTypedArray())

    // Session state
    private var session: ClaudeSession? = null
    private var isStreaming = false
    private val assistant = ClaudeAssistant()

    // Throttled UI update for streaming deltas
    private var pendingContent: String? = null
    private var pendingIndex: Int = -1
    private val updateTimer = javax.swing.Timer(80) {
        val text = pendingContent ?: return@Timer
        messagesModel.set(pendingIndex, ChatMessage(ChatRole.ASSISTANT, text))
        scrollToBottom()
    }.apply { isRepeats = false }

    init {
        setupUI()
        initSession()
    }

    private fun setupUI() {
        // ── Toolbar ──────────────────────────────────────────────
        val toolbar = JPanel(FlowLayout(FlowLayout.LEFT, 4, 2))

        toolbar.add(JLabel("Model:"))
        modelSelector.selectedItem = ClaudeModel.SONNET
        modelSelector.addActionListener {
            session?.model = modelSelector.selectedItem as ClaudeModel
        }
        toolbar.add(modelSelector)

        val diagnoseBtn = JButton("Diagnose")
        diagnoseBtn.toolTipText = "Auto-diagnose errors in terminal output"
        diagnoseBtn.addActionListener { runDiagnose() }
        toolbar.add(diagnoseBtn)

        val suggestBtn = JButton("Suggest")
        suggestBtn.toolTipText = "Suggest commands based on terminal context"
        suggestBtn.addActionListener { runSuggestCommands() }
        toolbar.add(suggestBtn)

        val clearBtn = JButton("Clear")
        clearBtn.addActionListener { clearChat() }
        toolbar.add(clearBtn)

        // ── Message List ─────────────────────────────────────────
        messagesList.cellRenderer = ChatMessageRenderer()
        messagesList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        // Enable variable height cells
        messagesList.fixedCellHeight = -1
        val scrollPane = JBScrollPane(messagesList)

        // ── Input Area ───────────────────────────────────────────
        val inputPanel = JPanel(BorderLayout(4, 0))
        inputArea.lineWrap = true
        inputArea.wrapStyleWord = true
        inputArea.border = BorderFactory.createCompoundBorder(
            BorderFactory.createLineBorder(
                UIManager.getColor("Component.borderColor") ?: Color.GRAY
            ),
            BorderFactory.createEmptyBorder(4, 4, 4, 4)
        )
        // Enter to send, Shift+Enter for newline
        inputArea.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(e: KeyEvent) {
                if (e.keyCode == KeyEvent.VK_ENTER && !e.isShiftDown) {
                    e.consume()
                    sendMessage()
                }
            }
        })
        sendButton.addActionListener { sendMessage() }

        inputPanel.add(JBScrollPane(inputArea), BorderLayout.CENTER)
        inputPanel.add(sendButton, BorderLayout.EAST)
        inputPanel.border = BorderFactory.createEmptyBorder(4, 4, 4, 4)

        // ── Layout ───────────────────────────────────────────────
        add(toolbar, BorderLayout.NORTH)
        add(scrollPane, BorderLayout.CENTER)
        add(inputPanel, BorderLayout.SOUTH)

        // Welcome message
        messagesModel.addElement(
            ChatMessage(
                ChatRole.ASSISTANT,
                "Ready. I can see your terminal output and help with server tasks. Ask me anything."
            )
        )
    }

    private fun initSession() {
        try {
            session = ClaudeSession().apply {
                server?.let { setServerContext(it) }
                connector?.let { attachTerminalBuffer(it.terminalBuffer) }
            }
        } catch (e: ClaudeCliNotFoundException) {
            messagesModel.addElement(
                ChatMessage(ChatRole.ASSISTANT, e.message ?: "Claude CLI not found.")
            )
        }
    }

    private fun sendMessage() {
        val text = inputArea.text.trim()
        if (text.isEmpty() || isStreaming || session == null) return

        inputArea.text = ""
        isStreaming = true
        sendButton.isEnabled = false

        messagesModel.addElement(ChatMessage(ChatRole.USER, text))

        // Placeholder for streaming response
        val assistantMsg = ChatMessage(ChatRole.ASSISTANT, "...")
        messagesModel.addElement(assistantMsg)
        val assistantIndex = messagesModel.size() - 1
        scrollToBottom()

        scope.launch {
            val response = StringBuilder()
            try {
                pendingIndex = assistantIndex
                session!!.chat(text).collect { event ->
                    when (event) {
                        is StreamEvent.TextDelta -> {
                            response.append(event.text)
                            pendingContent = response.toString()
                            SwingUtilities.invokeLater {
                                if (!updateTimer.isRunning) updateTimer.restart()
                            }
                        }
                        is StreamEvent.Done -> {
                            SwingUtilities.invokeLater {
                                updateTimer.stop()
                                // Flush final content
                                pendingContent?.let {
                                    messagesModel.set(assistantIndex, ChatMessage(ChatRole.ASSISTANT, it))
                                    scrollToBottom()
                                }
                                pendingContent = null
                                isStreaming = false
                                sendButton.isEnabled = true
                                inputArea.requestFocusInWindow()
                            }
                        }
                        is StreamEvent.Error -> {
                            SwingUtilities.invokeLater {
                                updateTimer.stop()
                                pendingContent = null
                                messagesModel.set(
                                    assistantIndex,
                                    ChatMessage(ChatRole.ASSISTANT, "Error: ${event.message}")
                                )
                                isStreaming = false
                                sendButton.isEnabled = true
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    messagesModel.set(
                        assistantIndex,
                        ChatMessage(ChatRole.ASSISTANT, "Error: ${e.message}")
                    )
                    isStreaming = false
                    sendButton.isEnabled = true
                }
            }
        }
    }

    private fun runDiagnose() {
        val srv = server ?: run {
            messagesModel.addElement(ChatMessage(ChatRole.ASSISTANT, "No server context. Connect to a server first."))
            return
        }
        val terminalContent = connector?.terminalBuffer?.getContent()
        if (terminalContent.isNullOrBlank()) {
            messagesModel.addElement(ChatMessage(ChatRole.ASSISTANT, "No terminal output to diagnose."))
            return
        }

        messagesModel.addElement(ChatMessage(ChatRole.ASSISTANT, "Diagnosing..."))
        val loadingIndex = messagesModel.size() - 1

        scope.launch {
            try {
                val result = assistant.diagnoseError(terminalContent, srv)
                SwingUtilities.invokeLater {
                    messagesModel.set(
                        loadingIndex,
                        ChatMessage(
                            ChatRole.ASSISTANT,
                            "DIAGNOSIS:\n\nError: ${result.error}\nCause: ${result.cause}\nFix: ${result.fix}\n\nCommands:\n${result.commands.joinToString("\n") { "  \$ $it" }}"
                        )
                    )
                    scrollToBottom()
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    messagesModel.set(loadingIndex, ChatMessage(ChatRole.ASSISTANT, "Diagnose error: ${e.message}"))
                }
            }
        }
    }

    private fun runSuggestCommands() {
        val srv = server ?: run {
            messagesModel.addElement(ChatMessage(ChatRole.ASSISTANT, "No server context. Connect to a server first."))
            return
        }
        val terminalContent = connector?.terminalBuffer?.getContent()
        if (terminalContent.isNullOrBlank()) {
            messagesModel.addElement(ChatMessage(ChatRole.ASSISTANT, "No terminal output for context."))
            return
        }

        messagesModel.addElement(ChatMessage(ChatRole.ASSISTANT, "Analyzing..."))
        val loadingIndex = messagesModel.size() - 1

        scope.launch {
            try {
                val suggestions = assistant.suggestCommands(terminalContent, srv)
                val text = if (suggestions.isNotEmpty()) {
                    "SUGGESTED COMMANDS:\n\n" + suggestions.joinToString("\n\n") {
                        "  \$ ${it.command}\n    ${it.description} [${it.risk}]"
                    }
                } else {
                    "No command suggestions available for current context."
                }
                SwingUtilities.invokeLater {
                    messagesModel.set(loadingIndex, ChatMessage(ChatRole.ASSISTANT, text))
                    scrollToBottom()
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    messagesModel.set(loadingIndex, ChatMessage(ChatRole.ASSISTANT, "Suggest error: ${e.message}"))
                }
            }
        }
    }

    private fun clearChat() {
        session?.clearHistory()
        messagesModel.clear()
        messagesModel.addElement(ChatMessage(ChatRole.ASSISTANT, "Chat cleared. Ready for new questions."))
    }

    private fun scrollToBottom() {
        messagesList.ensureIndexIsVisible(messagesModel.size() - 1)
    }

    fun dispose() {
        scope.cancel()
    }
}
