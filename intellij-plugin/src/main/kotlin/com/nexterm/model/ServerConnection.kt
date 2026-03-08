package com.nexterm.model

import java.util.UUID

data class ServerConnection(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val host: String,
    val port: Int = 22,
    val username: String,
    val authType: AuthType,
    val password: String? = null,
    val privateKeyPath: String? = null,
    val passphrase: String? = null,
    val jumpHost: JumpHostConfig? = null,
    val variables: List<ServerVariable> = emptyList(),
    val tags: List<String> = emptyList(),
    val color: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    var lastConnectedAt: Long? = null,
) {
    override fun toString(): String =
        "ServerConnection(id=$id, name=$name, host=$host, port=$port, username=$username, authType=$authType)"
}

enum class AuthType {
    PASSWORD, KEY, JUMP_HOST
}

data class JumpHostConfig(
    val host: String,
    val port: Int = 22,
    val username: String,
    val authType: AuthType,
    val password: String? = null,
    val privateKeyPath: String? = null,
) {
    override fun toString(): String =
        "JumpHostConfig(host=$host, port=$port, username=$username, authType=$authType)"
}

data class ServerVariable(
    val id: String = UUID.randomUUID().toString(),
    val name: String,           // e.g. "SUDO_PASSWORD"
    val description: String,    // e.g. "sudo password"
    val value: String,          // stored encrypted
    val triggers: List<PromptTrigger> = emptyList(),
) {
    override fun toString(): String =
        "ServerVariable(id=$id, name=$name, description=$description)"
}

data class PromptTrigger(
    val pattern: String,        // regex
    val type: TriggerType,
)

enum class TriggerType {
    SUDO, MYSQL, CUSTOM
}

// Default prompt patterns
object DefaultTriggers {
    val SUDO = listOf(
        PromptTrigger("\\[sudo\\] password for .+:", TriggerType.SUDO),
        PromptTrigger("Password:", TriggerType.SUDO),
    )
    val MYSQL = listOf(
        PromptTrigger("Enter password:", TriggerType.MYSQL),
    )

    fun forVariable(name: String): List<PromptTrigger> = when (name) {
        "SUDO_PASSWORD" -> SUDO
        "MYSQL_ROOT_PASSWORD" -> MYSQL
        else -> emptyList()
    }
}
