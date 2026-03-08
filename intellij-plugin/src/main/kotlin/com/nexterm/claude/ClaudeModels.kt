package com.nexterm.claude

enum class ClaudeModel(val id: String, val displayName: String) {
    HAIKU("claude-3-5-haiku-20241022", "Haiku (fast)"),
    SONNET("claude-sonnet-4-20250514", "Sonnet"),
    OPUS("claude-opus-4-20250514", "Opus (powerful)");

    override fun toString() = displayName
}
