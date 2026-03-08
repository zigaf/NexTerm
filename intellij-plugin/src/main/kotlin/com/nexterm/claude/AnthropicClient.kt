package com.nexterm.claude

import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.withContext

sealed class StreamEvent {
    data class TextDelta(val text: String) : StreamEvent()
    data class Error(val message: String) : StreamEvent()
    data object Done : StreamEvent()
}

/**
 * Invokes the `claude` CLI as a subprocess — uses the user's existing
 * Claude Code session (OAuth / API key) so no separate key is needed.
 */
class ClaudeCliClient {

    private var sessionId: String? = null

    companion object {
        /** Cached result so we only probe once per JVM. Thread-safe via lazy. */
        private val claudePath: String by lazy {
            val home = System.getProperty("user.home") ?: ""
            val candidates = mutableListOf(
                "claude",
                "/usr/local/bin/claude",
                "/opt/homebrew/bin/claude",
            )
            if (home.isNotEmpty()) {
                candidates += "$home/.local/bin/claude"
                candidates += "$home/.nvm/versions/node/default/bin/claude"
            }

            // Try each known path
            for (candidate in candidates) {
                if (probeClaudeCli(candidate)) return@lazy candidate
            }

            // Last resort: ask the shell via `which`
            try {
                val p = ProcessBuilder("sh", "-lc", "which claude")
                    .redirectErrorStream(true)
                    .start()
                val output = p.inputStream.bufferedReader().use { it.readText().trim() }
                p.waitFor()
                if (output.isNotEmpty() && probeClaudeCli(output)) return@lazy output
            } catch (_: Exception) { }

            throw ClaudeCliNotFoundException()
        }

        private fun probeClaudeCli(path: String): Boolean {
            return try {
                val p = ProcessBuilder(path, "--version")
                    .redirectErrorStream(true)
                    .start()
                try {
                    p.waitFor() == 0
                } finally {
                    p.inputStream.close()
                    p.errorStream.close()
                    p.destroy()
                }
            } catch (_: Exception) { false }
        }

        private fun findClaude(): String = claudePath
    }

    /**
     * Streaming multi-turn chat.
     *
     * The first call creates a new session; subsequent calls resume it
     * via `--resume <sessionId>` so conversation history is preserved
     * inside the CLI.
     */
    fun streamChat(
        model: String,
        systemPrompt: String,
        userMessage: String,
    ): Flow<StreamEvent> {
        val claude = findClaude()
        val cmd = mutableListOf(
            claude, "-p",
            "--model", model,
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
        )

        val resuming = sessionId != null
        if (resuming) {
            cmd += listOf("--resume", sessionId!!)
        } else if (systemPrompt.isNotEmpty()) {
            cmd += listOf("--append-system-prompt", systemPrompt)
        }
        cmd += "--"
        cmd += userMessage

        val process = ProcessBuilder(cmd)
            .redirectErrorStream(true)
            .start()
        process.outputStream.close()

        return flow {
            val reader = process.inputStream.bufferedReader()
            var lastText = ""

            try {
                var line: String? = reader.readLine()
                while (line != null) {
                    if (line.isNotBlank()) {
                        try {
                            val json = JsonParser.parseString(line).asJsonObject
                            when (json.get("type")?.asString) {
                                "system" -> {
                                    json.get("session_id")?.asString?.let { sessionId = it }
                                }
                                "assistant" -> {
                                    val content = json.getAsJsonObject("message")
                                        ?.getAsJsonArray("content")
                                    val text = content
                                        ?.firstOrNull { it.asJsonObject.get("type")?.asString == "text" }
                                        ?.asJsonObject?.get("text")?.asString ?: ""
                                    if (text.length > lastText.length) {
                                        emit(StreamEvent.TextDelta(text.substring(lastText.length)))
                                        lastText = text
                                    }
                                }
                                "result" -> {
                                    if (lastText.isEmpty()) {
                                        val result = json.get("result")?.asString ?: ""
                                        if (result.isNotEmpty()) emit(StreamEvent.TextDelta(result))
                                    }
                                    emit(StreamEvent.Done)
                                }
                            }
                        } catch (_: Exception) { /* skip malformed lines */ }
                    }
                    line = reader.readLine()
                }
            } finally {
                reader.close()
            }

            val exitCode = process.waitFor()
            if (exitCode != 0 && lastText.isEmpty()) {
                emit(StreamEvent.Error("Claude CLI exited with code $exitCode"))
            }
        }
            .flowOn(Dispatchers.IO)
            .onCompletion { process.destroy() }
    }

    /**
     * One-shot request — no session persistence. Used by [ClaudeAssistant].
     */
    suspend fun sendMessage(
        model: String,
        systemPrompt: String,
        userMessage: String,
    ): String = withContext(Dispatchers.IO) {
        val claude = findClaude()
        val cmd = mutableListOf(
            claude, "-p",
            "--model", model,
            "--output-format", "text",
            "--no-session-persistence",
        )
        if (systemPrompt.isNotEmpty()) {
            cmd += listOf("--append-system-prompt", systemPrompt)
        }
        cmd += "--"
        cmd += userMessage

        val process = ProcessBuilder(cmd)
            .redirectErrorStream(true)
            .start()
        process.outputStream.close()

        try {
            val result = process.inputStream.bufferedReader().use { it.readText() }
            val exitCode = process.waitFor()

            if (exitCode != 0) {
                throw Exception("Claude CLI exited with code $exitCode")
            }
            result.trim()
        } finally {
            process.destroy()
        }
    }

    fun resetSession() {
        sessionId = null
    }
}

class ClaudeCliNotFoundException : Exception(
    "Claude CLI not found. Install Claude Code first: https://docs.anthropic.com/en/docs/claude-code"
)
