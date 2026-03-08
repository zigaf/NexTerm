package com.nexterm.ssh

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import com.nexterm.model.AuthType
import com.nexterm.model.DefaultTriggers
import com.nexterm.model.ServerConnection
import com.nexterm.model.ServerVariable
import kotlinx.coroutines.*
import java.io.InputStream
import java.io.OutputStream

class SSHConnectionManager(private val project: Project) {

    private val activeConnections = java.util.concurrent.ConcurrentHashMap<String, SSHConnection>()

    fun connect(server: ServerConnection, onOutput: (String) -> Unit, onClose: () -> Unit): SSHConnection {
        val connection = SSHConnection(server, onOutput, onClose)
        connection.start()
        activeConnections[server.id] = connection
        return connection
    }

    fun getConnection(serverId: String) = activeConnections[serverId]

    fun disconnectAll() {
        activeConnections.values.forEach { it.disconnect() }
        activeConnections.clear()
    }
}

class SSHConnection(
    private val server: ServerConnection,
    private val onOutput: (String) -> Unit,
    private val onClose: () -> Unit,
) {
    private val jsch = JSch()
    private var session: Session? = null
    private var inputStream: InputStream? = null
    private var outputStream: OutputStream? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    companion object {
        private val IP_PATTERN = Regex("\\d{1,3}(\\.\\d{1,3}){3}")
        private val PASSWORD_PATTERN = Regex("password\\s*[:=]\\s*\\S+", RegexOption.IGNORE_CASE)
    }

    fun start() {
        scope.launch {
            try {
                session = buildSession()
                session!!.connect(10_000)

                val channel = session!!.openChannel("shell")
                inputStream = channel.inputStream
                outputStream = channel.outputStream

                channel.connect()
                onOutput("Connected to ${server.name}\r\n")

                // Start reading output
                readLoop()
            } catch (e: Exception) {
                val safeMsg = (e.message ?: "Unknown error")
                    .replace(IP_PATTERN, "<host>")
                    .replace(PASSWORD_PATTERN, "password=<redacted>")
                onOutput("\u001b[31mConnection error: $safeMsg\u001b[0m\r\n")
                onClose()
            }
        }
    }

    fun write(text: String) {
        outputStream?.write(text.toByteArray())
        outputStream?.flush()
    }

    fun disconnect() {
        scope.cancel()
        try { inputStream?.close() } catch (_: Exception) {}
        try { outputStream?.close() } catch (_: Exception) {}
        session?.disconnect()
        onClose()
    }

    private fun validateKeyPath(keyPath: String) {
        val resolved = java.io.File(keyPath).canonicalFile
        val home = java.io.File(System.getProperty("user.home")).canonicalFile
        require(resolved.startsWith(home)) { "Private key path must be under home directory: $resolved" }
    }

    private fun buildSession(): Session {
        val knownHosts = java.io.File(System.getProperty("user.home"), ".ssh/known_hosts")
        if (knownHosts.exists()) {
            jsch.setKnownHosts(knownHosts.absolutePath)
        }

        val s = when (server.authType) {
            AuthType.KEY -> {
                server.privateKeyPath?.let { validateKeyPath(it); jsch.addIdentity(it) }
                jsch.getSession(server.username, server.host, server.port)
            }
            AuthType.PASSWORD, AuthType.JUMP_HOST -> {
                val s = jsch.getSession(server.username, server.host, server.port)
                if (server.password != null) s.setPassword(server.password)
                s
            }
        }
        s.setConfig("StrictHostKeyChecking", "no")
        return s
    }

    private suspend fun readLoop() {
        val buf = ByteArray(4096)
        val input = inputStream ?: return
        val autofill = AutoFillDetector(server)

        withContext(Dispatchers.IO) {
            while (true) {
                val n = input.read(buf)
                if (n == -1) break
                val text = String(buf, 0, n)
                onOutput(text)

                // Check for auto-fill triggers
                val fillValue = autofill.check(text)
                if (fillValue != null) {
                    delay(100) // small delay before sending
                    write(fillValue + "\n")
                }
            }
            onClose()
        }
    }
}

/** Detects prompt patterns and returns the value to auto-fill */
class AutoFillDetector(private val server: ServerConnection) {
    private val buffer = StringBuilder()
    private var lastFillTime = 0L
    private var failedVariable: String? = null

    companion object {
        private val FAILURE_PATTERNS = listOf(
            Regex("Sorry, try again", RegexOption.IGNORE_CASE),
            Regex("incorrect password", RegexOption.IGNORE_CASE),
            Regex("Authentication failure", RegexOption.IGNORE_CASE),
            Regex("Permission denied", RegexOption.IGNORE_CASE),
        )
    }

    /** Pre-compiled trigger patterns per variable — built once. */
    private data class VariableWithPatterns(val variable: ServerVariable, val patterns: List<Regex>)
    private val variablePatterns: List<VariableWithPatterns> = server.variables.map { variable ->
        val triggers = variable.triggers.ifEmpty { DefaultTriggers.forVariable(variable.name) }
        VariableWithPatterns(variable, triggers.mapNotNull {
            try { Regex(it.pattern, RegexOption.IGNORE_CASE) }
            catch (_: java.util.regex.PatternSyntaxException) { null }
        })
    }

    fun check(output: String): String? {
        buffer.append(output)
        if (buffer.length > 500) buffer.delete(0, buffer.length - 500)

        val now = System.currentTimeMillis()
        if (now - lastFillTime < 500) return null

        // Detect failure after a previous autofill attempt
        if (failedVariable == null) {
            for (pattern in FAILURE_PATTERNS) {
                if (pattern.containsMatchIn(buffer)) {
                    failedVariable = buffer.toString()
                    buffer.clear()
                    return null
                }
            }
        }

        for ((variable, patterns) in variablePatterns) {
            // Skip variable that already failed in this prompt cycle
            if (failedVariable != null) {
                failedVariable = null
                return null
            }

            for (pattern in patterns) {
                if (pattern.containsMatchIn(buffer)) {
                    buffer.clear()
                    lastFillTime = now
                    return variable.value
                }
            }
        }
        return null
    }
}
