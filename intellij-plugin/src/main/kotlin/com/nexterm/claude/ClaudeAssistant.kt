package com.nexterm.claude

import com.google.gson.Gson
import com.nexterm.model.ServerConnection

data class AnalysisResult(
    val summary: String = "No analysis available",
    val issues: List<String> = emptyList(),
    val suggestions: List<String> = emptyList(),
)

data class CommandSuggestion(
    val command: String = "",
    val description: String = "",
    val risk: String = "safe",
)

data class DiagnosticResult(
    val error: String = "Unknown error",
    val cause: String = "Unable to determine cause",
    val fix: String = "Please review the output manually",
    val commands: List<String> = emptyList(),
)

class ClaudeAssistant {

    private val client = ClaudeCliClient()
    private val gson = Gson()
    private val model = ClaudeModel.SONNET.id

    companion object {
        private val CODE_FENCE_START = Regex("^```(?:json)?\\s*", RegexOption.MULTILINE)
        private val CODE_FENCE_END = Regex("\\s*```$", RegexOption.MULTILINE)
    }

    suspend fun analyzeLogs(logs: String, server: ServerConnection): AnalysisResult {
        val response = client.sendMessage(
            model = model,
            systemPrompt = """You are a Linux server diagnostics assistant. Analyze server logs and output JSON with these fields:
- "summary": brief plain-text summary of what the logs show
- "issues": array of identified problems
- "suggestions": array of actionable recommendations
Respond with ONLY valid JSON, no markdown.""",
            userMessage = "Server: ${server.name} (${server.username}@${server.host})\n\nLogs:\n${truncate(logs, 6000)}",
        )
        return parseJson(response, AnalysisResult())
    }

    suspend fun suggestCommands(context: String, server: ServerConnection): List<CommandSuggestion> {
        val response = client.sendMessage(
            model = model,
            systemPrompt = """You are a Linux command assistant. Based on the user's context (terminal output or question), suggest relevant commands.
Output a JSON array of objects with:
- "command": the shell command
- "description": what it does (1 sentence)
- "risk": "safe", "moderate", or "dangerous"
Respond with ONLY a valid JSON array, no markdown. Suggest 3-5 commands.""",
            userMessage = "Server: ${server.name} (${server.username}@${server.host})\n\nContext:\n${truncate(context, 4000)}",
        )
        return parseJsonArray(response)
    }

    suspend fun diagnoseError(terminalOutput: String, server: ServerConnection): DiagnosticResult {
        val response = client.sendMessage(
            model = model,
            systemPrompt = """You are a Linux troubleshooting expert. Diagnose the terminal error and output JSON with:
- "error": the specific error identified
- "cause": likely root cause (1-2 sentences)
- "fix": recommended fix (1-2 sentences)
- "commands": array of commands to run to fix it
Respond with ONLY valid JSON, no markdown.""",
            userMessage = "Server: ${server.name} (${server.username}@${server.host})\n\nTerminal output:\n${truncate(terminalOutput, 4000)}",
        )
        return parseJson(response, DiagnosticResult())
    }

    private fun truncate(text: String, maxLen: Int): String {
        if (text.length <= maxLen) return text
        return text.substring(text.length - maxLen)
    }

    private fun cleanJson(text: String): String {
        return text
            .replace(CODE_FENCE_START, "")
            .replace(CODE_FENCE_END, "")
            .trim()
    }

    private inline fun <reified T> parseJson(text: String, fallback: T): T {
        return try {
            gson.fromJson(cleanJson(text), T::class.java)
        } catch (_: Exception) {
            fallback
        }
    }

    private fun parseJsonArray(text: String): List<CommandSuggestion> {
        return try {
            val cleaned = cleanJson(text)
            val array = com.google.gson.JsonParser.parseString(cleaned).asJsonArray
            array.map { gson.fromJson(it, CommandSuggestion::class.java) }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
