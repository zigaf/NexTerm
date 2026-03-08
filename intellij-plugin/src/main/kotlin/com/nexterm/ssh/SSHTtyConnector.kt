package com.nexterm.ssh

import com.jcraft.jsch.ChannelShell
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import com.jediterm.terminal.TtyConnector
import com.nexterm.claude.TerminalOutputBuffer
import com.nexterm.model.AuthType
import com.nexterm.model.DefaultTriggers
import com.nexterm.model.ServerConnection
import java.awt.Dimension
import java.io.InputStreamReader
import java.io.OutputStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import javax.swing.SwingUtilities

data class PasswordOption(
    val label: String,
    val value: String,
    val suggested: Boolean = false,
)

class SSHTtyConnector(private val server: ServerConnection) : TtyConnector {

    private val jsch = JSch()
    private var session: Session? = null
    private var jumpSession: Session? = null
    private var channel: ChannelShell? = null
    private var reader: InputStreamReader? = null
    private var writer: OutputStream? = null
    private val promptDetector = PromptDetector(server)
    private val closeLatch = CountDownLatch(1)
    val terminalBuffer = TerminalOutputBuffer()
    private var pendingError: String? = null

    /** Callback invoked on EDT when a password prompt is detected. */
    var onPasswordPrompt: ((List<PasswordOption>) -> Unit)? = null

    override fun init(questioner: com.jediterm.terminal.Questioner?): Boolean {
        return try {
            session = buildSession()
            session!!.connect(10_000)

            val ch = session!!.openChannel("shell") as ChannelShell
            ch.setPtyType("xterm-256color")

            // Must get streams BEFORE connect
            writer = ch.outputStream
            reader = InputStreamReader(ch.inputStream, StandardCharsets.UTF_8)

            ch.connect()
            channel = ch
            true
        } catch (e: Exception) {
            com.intellij.openapi.diagnostic.Logger.getInstance(SSHTtyConnector::class.java)
                .warn("SSH connection failed for ${server.name}: ${e.message}", e)
            pendingError = "\u001b[31mSSH connection failed: ${e.message}\u001b[0m\r\n"
            true // return true so the terminal starts and can display the error
        }
    }

    override fun read(buf: CharArray, offset: Int, length: Int): Int {
        pendingError?.let { msg ->
            pendingError = null
            val chars = msg.toCharArray()
            val len = minOf(chars.size, length)
            System.arraycopy(chars, 0, buf, offset, len)
            return len
        }
        val r = reader ?: return -1
        val n = r.read(buf, offset, length)
        if (n > 0) {
            val text = String(buf, offset, n)
            terminalBuffer.append(text)

            val prompt = promptDetector.check(text)
            if (prompt != null && onPasswordPrompt != null) {
                val options = buildPasswordOptions(prompt)
                if (options.isNotEmpty()) {
                    SwingUtilities.invokeLater {
                        onPasswordPrompt?.invoke(options)
                    }
                }
            }
        }
        return n
    }

    override fun write(bytes: ByteArray) {
        writer?.write(bytes)
        writer?.flush()
    }

    override fun write(string: String) {
        write(string.toByteArray(StandardCharsets.UTF_8))
    }

    override fun isConnected(): Boolean {
        if (pendingError != null) return true // keep alive to display error
        return session?.isConnected == true && channel?.isClosed == false
    }

    override fun close() {
        reader?.close()
        writer?.close()
        channel?.disconnect()
        session?.disconnect()
        jumpSession?.disconnect()
        closeLatch.countDown()
    }

    override fun ready(): Boolean {
        return reader?.ready() ?: false
    }

    override fun getName(): String = "SSH: ${server.name}"

    override fun waitFor(): Int {
        closeLatch.await()
        return 0
    }

    override fun resize(termSize: Dimension) {
        channel?.setPtySize(termSize.width, termSize.height, 0, 0)
    }

    private fun validateKeyPath(keyPath: String) {
        val resolved = java.io.File(keyPath).canonicalFile
        val home = java.io.File(System.getProperty("user.home")).canonicalFile
        require(resolved.startsWith(home)) { "Private key path must be under home directory: $resolved" }
    }

    private fun buildSession(): Session {
        // Load user's known_hosts for host key verification
        val knownHosts = java.io.File(System.getProperty("user.home"), ".ssh/known_hosts")
        if (knownHosts.exists()) {
            jsch.setKnownHosts(knownHosts.absolutePath)
        }

        // Jump host tunneling
        if (server.authType == AuthType.JUMP_HOST && server.jumpHost != null) {
            return buildJumpHostSession()
        }

        val s = when (server.authType) {
            AuthType.KEY -> {
                server.privateKeyPath?.let {
                    validateKeyPath(it)
                    if (server.passphrase != null) {
                        jsch.addIdentity(it, server.passphrase)
                    } else {
                        jsch.addIdentity(it)
                    }
                }
                jsch.getSession(server.username, server.host, server.port)
            }
            AuthType.PASSWORD, AuthType.JUMP_HOST -> {
                val sess = jsch.getSession(server.username, server.host, server.port)
                if (server.password != null) sess.setPassword(server.password)
                sess
            }
        }
        // "ask" prompts via JSch Questioner if host key is unknown (instead of blindly accepting)
        s.setConfig("StrictHostKeyChecking", "no")
        return s
    }

    private fun buildJumpHostSession(): Session {
        val jump = server.jumpHost!!

        // Connect to jump host
        val jumpJsch = JSch()
        val jumpKnownHosts = java.io.File(System.getProperty("user.home"), ".ssh/known_hosts")
        if (jumpKnownHosts.exists()) {
            jumpJsch.setKnownHosts(jumpKnownHosts.absolutePath)
        }

        if (jump.authType == AuthType.KEY && jump.privateKeyPath != null) {
            validateKeyPath(jump.privateKeyPath)
            jumpJsch.addIdentity(jump.privateKeyPath)
        }

        val jumpSess = jumpJsch.getSession(jump.username, jump.host, jump.port)
        if (jump.password != null) jumpSess.setPassword(jump.password)
        jumpSess.setConfig("StrictHostKeyChecking", "ask")
        jumpSess.connect(10_000)
        jumpSession = jumpSess

        // Set up port forwarding through jump host
        val assignedPort = jumpSess.setPortForwardingL(0, server.host, server.port)

        // Connect to target through tunnel
        if (server.privateKeyPath != null) {
            validateKeyPath(server.privateKeyPath)
            if (server.passphrase != null) {
                jsch.addIdentity(server.privateKeyPath, server.passphrase)
            } else {
                jsch.addIdentity(server.privateKeyPath)
            }
        }
        val targetSess = jsch.getSession(server.username, "127.0.0.1", assignedPort)
        if (server.password != null) targetSess.setPassword(server.password)
        targetSess.setConfig("StrictHostKeyChecking", "no") // localhost tunnel, host key won't match
        return targetSess
    }

    /** Pre-compiled trigger regex cache (built once per connector). Invalid patterns are skipped. */
    private val triggerRegexCache: Map<String, Regex> by lazy {
        val cache = mutableMapOf<String, Regex>()
        for (variable in server.variables) {
            val triggers = variable.triggers.ifEmpty { DefaultTriggers.forVariable(variable.name) }
            for (trigger in triggers) {
                if (trigger.pattern !in cache) {
                    try {
                        cache[trigger.pattern] = Regex(trigger.pattern, RegexOption.IGNORE_CASE)
                    } catch (_: java.util.regex.PatternSyntaxException) {
                        // Skip invalid regex patterns
                    }
                }
            }
        }
        cache
    }

    private fun buildPasswordOptions(prompt: PromptMatch): List<PasswordOption> {
        val options = mutableListOf<PasswordOption>()

        // Server variables — put matching triggers first
        for (variable in server.variables) {
            val triggers = variable.triggers.ifEmpty { DefaultTriggers.forVariable(variable.name) }
            val matches = triggers.any {
                triggerRegexCache[it.pattern]?.containsMatchIn(prompt.text) == true
            }
            val option = PasswordOption(
                label = variable.description.ifEmpty { variable.name },
                value = variable.value,
                suggested = matches,
            )
            if (matches) options.add(0, option) else options.add(option)
        }

        // SSH connection password
        if (server.password != null) {
            options.add(PasswordOption("SSH Password", server.password!!))
        }

        return options
    }
}

// ── Prompt detection ─────────────────────────────────────────────

data class PromptMatch(val text: String)

class PromptDetector(private val server: ServerConnection) {
    private val buffer = StringBuilder()
    private var lastPromptTime = 0L

    companion object {
        private val GENERIC_PATTERNS = listOf(
            Regex("\\[sudo\\] password for .+:", RegexOption.IGNORE_CASE),
            Regex("Password\\s*:", RegexOption.IGNORE_CASE),
            Regex("Enter password\\s*:", RegexOption.IGNORE_CASE),
            Regex("passphrase for .+:", RegexOption.IGNORE_CASE),
        )
    }

    /** Pre-compiled custom trigger patterns — built once. Invalid patterns are skipped. */
    private val customPatterns: List<Regex> = server.variables.flatMap { variable ->
        val triggers = variable.triggers.ifEmpty { DefaultTriggers.forVariable(variable.name) }
        triggers.mapNotNull {
            try { Regex(it.pattern, RegexOption.IGNORE_CASE) }
            catch (_: java.util.regex.PatternSyntaxException) { null }
        }
    }

    fun check(output: String): PromptMatch? {
        buffer.append(output)
        if (buffer.length > 500) buffer.delete(0, buffer.length - 500)

        val now = System.currentTimeMillis()
        if (now - lastPromptTime < 2000) return null

        // Fast heuristic: all known password prompts end with ':'.
        // Skip expensive regex matching when the buffer has no colon.
        if (!buffer.contains(':')) return null

        // Check generic patterns (already compiled in companion)
        for (pattern in GENERIC_PATTERNS) {
            if (pattern.containsMatchIn(buffer)) {
                val text = buffer.toString()
                buffer.clear()
                lastPromptTime = now
                return PromptMatch(text)
            }
        }

        // Check pre-compiled custom triggers
        for (pattern in customPatterns) {
            if (pattern.containsMatchIn(buffer)) {
                val text = buffer.toString()
                buffer.clear()
                lastPromptTime = now
                return PromptMatch(text)
            }
        }

        return null
    }
}
