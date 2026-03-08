package com.nexterm.claude

enum class ChatRole { USER, ASSISTANT }

data class ChatMessage(
    val role: ChatRole,
    val content: String,
    val timestamp: Long = System.currentTimeMillis(),
)
