package com.nexterm.claude

import com.nexterm.model.ServerConnection
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf

class ClaudeSession {

    private val client = ClaudeCliClient()
    var model: ClaudeModel = ClaudeModel.SONNET
    private val chatLog = mutableListOf<ChatMessage>()
    private val maxChatLogSize = 100
    private val minRequestIntervalMs = 1000L
    private var lastRequestTime = 0L
    var terminalBuffer: TerminalOutputBuffer? = null
        private set
    private var serverContext: ServerContext? = null

    private data class ServerContext(val name: String, val host: String, val username: String)

    // ── Terminal Capture ──────────────────────────────────────────

    fun attachTerminalBuffer(buffer: TerminalOutputBuffer) {
        this.terminalBuffer = buffer
    }

    fun setServerContext(server: ServerConnection) {
        this.serverContext = ServerContext(
            name = server.name,
            host = server.host,
            username = server.username,
        )
    }

    // ── Streaming Chat ────────────────────────────────────────────

    fun chat(userMessage: String): Flow<StreamEvent> {
        val now = System.currentTimeMillis()
        val elapsed = now - lastRequestTime
        if (elapsed < minRequestIntervalMs) {
            return flow {
                emit(StreamEvent.Error("Please wait before sending another message."))
            }
        }
        lastRequestTime = now

        val terminalContent = terminalBuffer?.getContent() ?: ""
        val sanitized = sanitizeTerminalOutput(terminalContent)
        val contextBlock = if (sanitized.isNotEmpty()) {
            "\n\n<terminal_output>\n$sanitized\n</terminal_output>"
        } else ""

        val fullUserMessage = userMessage + contextBlock

        chatLog.add(ChatMessage(ChatRole.USER, userMessage))
        if (chatLog.size > maxChatLogSize) chatLog.removeFirst()
        val fullResponse = StringBuilder()

        return flow {
            client.streamChat(
                model = model.id,
                systemPrompt = buildSystemPrompt(),
                userMessage = fullUserMessage,
            ).collect { event ->
                when (event) {
                    is StreamEvent.TextDelta -> {
                        fullResponse.append(event.text)
                        emit(event)
                    }
                    is StreamEvent.Done -> {
                        chatLog.add(ChatMessage(ChatRole.ASSISTANT, fullResponse.toString()))
                        if (chatLog.size > maxChatLogSize) chatLog.removeFirst()
                        emit(event)
                    }
                    is StreamEvent.Error -> emit(event)
                }
            }
        }
    }

    // ── History Management ────────────────────────────────────────

    fun getHistory(): List<ChatMessage> = chatLog.toList()

    fun clearHistory() {
        chatLog.clear()
        client.resetSession()
    }

    // ── System Prompt ─────────────────────────────────────────────

    companion object {
        private val ANSI_ESCAPE = Regex("\u001B\\[[0-9;]*[a-zA-Z]")
        private val SECRET_PATTERN = Regex(
            "(password|token|secret|api_key|apikey|credential)\\s*[=:]\\s*\\S+",
            RegexOption.IGNORE_CASE,
        )
    }

    private fun sanitizeTerminalOutput(output: String): String {
        return output
            .replace(ANSI_ESCAPE, "")
            .replace(SECRET_PATTERN) { match ->
                val key = match.groupValues[1]
                "$key=<redacted>"
            }
    }

    private fun buildSystemPrompt(): String {
        val serverInfo = serverContext?.let {
            "The user is connected to: ${it.name} (${it.username}@${it.host})"
        } ?: "No server connection context available."

        return """You are a Linux server assistant embedded in a terminal SSH manager called NexTerm.

$serverInfo

You can see recent terminal output wrapped in <terminal_output> tags in the user messages. Use this context to understand what's happening on the server.

Guidelines:
- Be concise and practical
- When suggesting commands, prefix with ${'$'} for easy copying
- Warn about dangerous commands (rm -rf, dd, etc.)
- If you see an error in the terminal output, proactively explain it
- You can analyze logs, suggest fixes, explain output, and help with server administration
- Format output as plain text (no markdown headers), use indentation for structure"""
    }
}
