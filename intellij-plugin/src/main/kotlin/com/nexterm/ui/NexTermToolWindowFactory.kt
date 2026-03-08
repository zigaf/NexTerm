package com.nexterm.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.terminal.JBTerminalSystemSettingsProviderBase
import com.intellij.terminal.JBTerminalWidget
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.nexterm.model.ServerConnection
import com.nexterm.ssh.SSHTtyConnector
import com.nexterm.vault.NexTermVaultService
import java.awt.BorderLayout
import java.awt.Color
import java.awt.FlowLayout
import java.awt.Font
import javax.swing.*

class NexTermToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = NexTermPanel(project, toolWindow)
        val content = ContentFactory.getInstance().createContent(panel, "Servers", false)
        content.isCloseable = false
        toolWindow.contentManager.addContent(content)
    }
}

class NexTermPanel(
    private val project: Project,
    private val toolWindow: ToolWindow,
) : JPanel(BorderLayout()) {

    private val vault = service<NexTermVaultService>()
    private val listModel = DefaultListModel<ServerConnection>()
    private val serverList = JBList(listModel)
    private val activeConnectors = mutableMapOf<String, SSHTtyConnector>()

    init {
        setupUI()
        refreshList()
    }

    private fun setupUI() {
        // Toolbar
        val toolbar = JPanel(FlowLayout(FlowLayout.LEFT))
        val addBtn = JButton("Add Server")
        val connectBtn = JButton("Connect")
        val editBtn = JButton("Edit")
        val deleteBtn = JButton("Delete")

        val claudeBtn = JButton("Claude Chat")

        toolbar.add(addBtn)
        toolbar.add(connectBtn)
        toolbar.add(editBtn)
        toolbar.add(deleteBtn)
        toolbar.add(claudeBtn)

        // Server list
        serverList.cellRenderer = ServerListCellRenderer()
        serverList.selectionMode = ListSelectionModel.SINGLE_SELECTION

        // Double-click to connect
        serverList.addMouseListener(object : java.awt.event.MouseAdapter() {
            override fun mouseClicked(e: java.awt.event.MouseEvent) {
                if (e.clickCount == 2) connectSelected()
            }
        })

        addBtn.addActionListener { showAddServerDialog() }
        connectBtn.addActionListener { connectSelected() }
        editBtn.addActionListener { editSelected() }
        deleteBtn.addActionListener { deleteSelected() }
        claudeBtn.addActionListener { openClaudeChatForSelected() }

        add(toolbar, BorderLayout.NORTH)
        add(JBScrollPane(serverList), BorderLayout.CENTER)
    }

    private fun connectSelected() {
        val meta = serverList.selectedValue ?: return
        val server = vault.getServer(meta.id) ?: return
        openTerminalForServer(server)
    }

    private fun openTerminalForServer(server: ServerConnection) {
        val disposable = Disposer.newDisposable("NexTerm-SSH-${server.id}")
        val settingsProvider = JBTerminalSystemSettingsProviderBase()
        val widget = JBTerminalWidget(project, settingsProvider, disposable)

        val connector = SSHTtyConnector(server)
        activeConnectors[server.id] = connector
        widget.createTerminalSession(connector)
        widget.start()

        // Wrap terminal in a panel with toolbar
        val wrapper = JPanel(BorderLayout())
        val toolbar = JPanel(FlowLayout(FlowLayout.LEFT, 4, 2))

        val disconnectBtn = JButton("Disconnect")
        disconnectBtn.toolTipText = "Close this SSH connection"

        val claudeBtn = JButton("Ask Claude")
        claudeBtn.toolTipText = "Toggle Claude AI chat panel below the terminal"

        toolbar.add(disconnectBtn)
        toolbar.add(claudeBtn)

        // Password prompt bar (hidden by default)
        val promptBar = JPanel(FlowLayout(FlowLayout.LEFT, 6, 3))
        promptBar.isVisible = false
        promptBar.background = UIManager.getColor("EditorPane.background")
            ?: Color(49, 51, 53)
        promptBar.border = BorderFactory.createMatteBorder(
            0, 0, 1, 0,
            UIManager.getColor("Separator.separatorColor") ?: Color.GRAY,
        )

        // Stack toolbar + promptBar at the top
        val topPanel = JPanel()
        topPanel.layout = BoxLayout(topPanel, BoxLayout.Y_AXIS)
        topPanel.add(toolbar)
        topPanel.add(promptBar)

        wrapper.add(topPanel, BorderLayout.NORTH)
        wrapper.add(widget, BorderLayout.CENTER)

        // Wire password prompt callback
        connector.onPasswordPrompt = { options ->
            promptBar.removeAll()
            promptBar.add(JLabel("Password:"))

            for (option in options) {
                val btn = JButton(option.label)
                if (option.suggested) {
                    btn.font = btn.font.deriveFont(Font.BOLD)
                    btn.toolTipText = "Matches detected prompt"
                }
                btn.addActionListener {
                    connector.write(option.value + "\n")
                    promptBar.isVisible = false
                    topPanel.revalidate()
                }
                promptBar.add(btn)
            }

            val dismissBtn = JButton("Dismiss")
            dismissBtn.addActionListener {
                promptBar.isVisible = false
                topPanel.revalidate()
            }
            promptBar.add(dismissBtn)

            promptBar.isVisible = true
            topPanel.revalidate()
            topPanel.repaint()
        }

        // Claude chat — embedded as a split panel (created lazily)
        var chatPanel: ClaudeChatPanel? = null
        var splitPane: JSplitPane? = null

        val content = ContentFactory.getInstance().createContent(
            wrapper, "SSH: ${server.name}", false
        )
        content.isCloseable = true
        content.setDisposer(disposable)
        Disposer.register(disposable) {
            activeConnectors.remove(server.id)
            chatPanel?.dispose()
        }

        disconnectBtn.addActionListener {
            toolWindow.contentManager.removeContent(content, true)
        }

        claudeBtn.addActionListener {
            if (chatPanel == null) {
                // First toggle: create chat panel and split pane
                chatPanel = ClaudeChatPanel(server, connector)
                splitPane = JSplitPane(JSplitPane.VERTICAL_SPLIT, widget, chatPanel).apply {
                    resizeWeight = 0.55
                    dividerSize = 5
                    isContinuousLayout = true
                }
                wrapper.remove(widget)
                wrapper.add(splitPane!!, BorderLayout.CENTER)
                wrapper.revalidate()
                wrapper.repaint()
                SwingUtilities.invokeLater {
                    splitPane!!.dividerLocation = (splitPane!!.height * 0.55).toInt()
                }
                claudeBtn.text = "Hide Claude"
            } else if (splitPane!!.bottomComponent != null) {
                // Hide chat
                splitPane!!.bottomComponent = null
                splitPane!!.dividerSize = 0
                claudeBtn.text = "Ask Claude"
            } else {
                // Show chat
                splitPane!!.bottomComponent = chatPanel
                splitPane!!.dividerSize = 5
                claudeBtn.text = "Hide Claude"
                SwingUtilities.invokeLater {
                    splitPane!!.dividerLocation = (splitPane!!.height * 0.55).toInt()
                }
            }
        }

        toolWindow.contentManager.addContent(content)
        toolWindow.contentManager.setSelectedContent(content)
    }

    private fun openClaudeChatForSelected() {
        val server = serverList.selectedValue
        val connector = server?.let { activeConnectors[it.id] }
        openClaudeChatForServer(server, connector)
    }

    private fun openClaudeChatForServer(server: ServerConnection?, connector: SSHTtyConnector?) {
        val chatPanel = ClaudeChatPanel(server, connector)

        val disposable = Disposer.newDisposable("NexTerm-Claude-${server?.id ?: "global"}")
        Disposer.register(disposable) { chatPanel.dispose() }

        val wrapper = JPanel(BorderLayout())
        val toolbar = JPanel(FlowLayout(FlowLayout.LEFT, 4, 2))
        val closeBtn = JButton("Close")
        closeBtn.toolTipText = "Close this Claude chat"
        toolbar.add(closeBtn)
        wrapper.add(toolbar, BorderLayout.NORTH)
        wrapper.add(chatPanel, BorderLayout.CENTER)

        val content = ContentFactory.getInstance().createContent(
            wrapper,
            "Claude${server?.let { ": ${it.name}" } ?: ""}",
            false
        )
        content.isCloseable = true
        content.setDisposer(disposable)

        closeBtn.addActionListener {
            toolWindow.contentManager.removeContent(content, true)
        }

        toolWindow.contentManager.addContent(content)
        toolWindow.contentManager.setSelectedContent(content)
    }

    private fun editSelected() {
        val meta = serverList.selectedValue ?: return
        val server = vault.getServer(meta.id) ?: return
        val dialog = EditServerDialog(project, vault, server)
        if (dialog.showAndGet()) {
            refreshList()
        }
    }

    private fun deleteSelected() {
        val server = serverList.selectedValue ?: return
        val confirm = JOptionPane.showConfirmDialog(
            this, "Delete server \"${server.name}\"?", "Confirm", JOptionPane.YES_NO_OPTION
        )
        if (confirm == JOptionPane.YES_OPTION) {
            vault.deleteServer(server.id)
            refreshList()
        }
    }

    private fun showAddServerDialog() {
        val dialog = AddServerDialog(project, vault)
        if (dialog.showAndGet()) {
            refreshList()
        }
    }

    private fun refreshList() {
        listModel.clear()
        vault.getAllServersMeta().forEach { listModel.addElement(it) }
    }
}

class ServerListCellRenderer : DefaultListCellRenderer() {
    override fun getListCellRendererComponent(
        list: JList<*>, value: Any?, index: Int, isSelected: Boolean, cellHasFocus: Boolean
    ): java.awt.Component {
        super.getListCellRendererComponent(list, value, index, isSelected, cellHasFocus)
        if (value is ServerConnection) {
            val eName = com.intellij.openapi.util.text.StringUtil.escapeXmlEntities(value.name)
            val eUser = com.intellij.openapi.util.text.StringUtil.escapeXmlEntities(value.username)
            val eHost = com.intellij.openapi.util.text.StringUtil.escapeXmlEntities(value.host)
            text = "<html><b>$eName</b> <font color='gray'>$eUser@$eHost:${value.port}</font></html>"
        }
        return this
    }
}
