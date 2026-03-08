package com.nexterm.ui

import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.components.JBTextField
import com.nexterm.model.AuthType
import com.nexterm.model.ServerConnection
import com.nexterm.model.ServerVariable
import com.nexterm.vault.NexTermVaultService
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import javax.swing.*

open class AddServerDialog(
    project: Project,
    private val vault: NexTermVaultService,
) : DialogWrapper(project) {

    protected val nameField = JBTextField()
    protected val hostField = JBTextField()
    protected val portField = JBTextField("22")
    protected val usernameField = JBTextField("root")
    protected val authTypeBox = JComboBox(arrayOf("Password", "Key", "Jump Host"))
    protected val passwordField = JBPasswordField()
    protected val keyPathField = JBTextField()
    protected val passphraseField = JBPasswordField()
    protected val sudoPasswordField = JBPasswordField()
    protected val mysqlPasswordField = JBPasswordField()

    init {
        title = "NexTerm — Add Server"
        init()
    }

    override fun createCenterPanel(): JComponent {
        val panel = JPanel(GridBagLayout())
        val gbc = GridBagConstraints().apply {
            fill = GridBagConstraints.HORIZONTAL
            insets = Insets(4, 8, 4, 8)
        }

        fun row(label: String, field: JComponent, y: Int) {
            gbc.gridx = 0; gbc.gridy = y; gbc.weightx = 0.3
            panel.add(JLabel(label), gbc)
            gbc.gridx = 1; gbc.weightx = 0.7
            panel.add(field, gbc)
        }

        row("Server Name:", nameField, 0)
        row("Host / IP:", hostField, 1)
        row("Port:", portField, 2)
        row("Username:", usernameField, 3)
        row("Auth Type:", authTypeBox, 4)
        row("SSH Password:", passwordField, 5)
        row("Private Key Path:", keyPathField, 6)
        row("Key Passphrase:", passphraseField, 7)

        // Separator
        gbc.gridx = 0; gbc.gridy = 8; gbc.gridwidth = 2
        panel.add(JSeparator(), gbc)
        gbc.gridwidth = 1

        gbc.gridx = 0; gbc.gridy = 9; gbc.gridwidth = 2
        panel.add(JLabel("<html><b>Server Variables (auto-fill)</b></html>"), gbc)
        gbc.gridwidth = 1

        row("sudo Password:", sudoPasswordField, 10)
        row("MySQL Root Password:", mysqlPasswordField, 11)

        // Toggle fields based on auth type
        authTypeBox.addActionListener { updateAuthFieldVisibility() }
        updateAuthFieldVisibility()

        panel.preferredSize = java.awt.Dimension(480, 440)
        return panel
    }

    private fun updateAuthFieldVisibility() {
        val isPassword = authTypeBox.selectedIndex == 0
        val isKey = authTypeBox.selectedIndex == 1
        passwordField.isEnabled = isPassword
        keyPathField.isEnabled = isKey
        passphraseField.isEnabled = isKey
    }

    override fun doValidate(): com.intellij.openapi.ui.ValidationInfo? {
        if (nameField.text.isBlank()) return com.intellij.openapi.ui.ValidationInfo("Server name is required", nameField)
        if (nameField.text.length > 255) return com.intellij.openapi.ui.ValidationInfo("Name too long (max 255)", nameField)
        if (hostField.text.isBlank()) return com.intellij.openapi.ui.ValidationInfo("Host is required", hostField)
        if (hostField.text.length > 255) return com.intellij.openapi.ui.ValidationInfo("Host too long (max 255)", hostField)
        if (usernameField.text.isBlank()) return com.intellij.openapi.ui.ValidationInfo("Username is required", usernameField)
        if (usernameField.text.length > 128) return com.intellij.openapi.ui.ValidationInfo("Username too long (max 128)", usernameField)
        val port = portField.text.toIntOrNull()
        if (port == null || port < 1 || port > 65535) return com.intellij.openapi.ui.ValidationInfo("Port must be 1-65535", portField)
        return null
    }

    override fun doOKAction() {
        val server = buildServer()
        vault.saveServer(server)
        super.doOKAction()
    }

    protected open fun buildServer(): ServerConnection {
        val variables = mutableListOf<ServerVariable>()

        val sudoPwd = String(sudoPasswordField.password)
        if (sudoPwd.isNotBlank()) {
            variables.add(ServerVariable(name = "SUDO_PASSWORD", description = "sudo password", value = sudoPwd))
        }

        val mysqlPwd = String(mysqlPasswordField.password)
        if (mysqlPwd.isNotBlank()) {
            variables.add(ServerVariable(name = "MYSQL_ROOT_PASSWORD", description = "MySQL root password", value = mysqlPwd))
        }

        val authType = when (authTypeBox.selectedIndex) {
            1 -> AuthType.KEY
            2 -> AuthType.JUMP_HOST
            else -> AuthType.PASSWORD
        }

        return ServerConnection(
            name = nameField.text,
            host = hostField.text,
            port = portField.text.toIntOrNull() ?: 22,
            username = usernameField.text,
            authType = authType,
            password = if (authType == AuthType.PASSWORD) String(passwordField.password).takeIf { it.isNotEmpty() } else null,
            privateKeyPath = keyPathField.text.takeIf { it.isNotBlank() },
            passphrase = if (authType == AuthType.KEY) String(passphraseField.password).takeIf { it.isNotEmpty() } else null,
            variables = variables,
        )
    }
}
