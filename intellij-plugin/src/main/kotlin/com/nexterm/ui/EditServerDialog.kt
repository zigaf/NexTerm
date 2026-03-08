package com.nexterm.ui

import com.intellij.openapi.project.Project
import com.nexterm.model.AuthType
import com.nexterm.model.ServerConnection
import com.nexterm.vault.NexTermVaultService

class EditServerDialog(
    project: Project,
    vault: NexTermVaultService,
    private val existing: ServerConnection,
) : AddServerDialog(project, vault) {

    init {
        title = "NexTerm — Edit Server"
        prefillFields()
    }

    private fun prefillFields() {
        nameField.text = existing.name
        hostField.text = existing.host
        portField.text = existing.port.toString()
        usernameField.text = existing.username

        authTypeBox.selectedIndex = when (existing.authType) {
            AuthType.PASSWORD -> 0
            AuthType.KEY -> 1
            AuthType.JUMP_HOST -> 2
        }

        existing.password?.let { passwordField.text = it }
        existing.privateKeyPath?.let { keyPathField.text = it }
        existing.passphrase?.let { passphraseField.text = it }

        // Pre-fill variables
        existing.variables.find { it.name == "SUDO_PASSWORD" }?.let {
            sudoPasswordField.text = it.value
        }
        existing.variables.find { it.name == "MYSQL_ROOT_PASSWORD" }?.let {
            mysqlPasswordField.text = it.value
        }
    }

    override fun buildServer(): ServerConnection {
        val base = super.buildServer()
        return base.copy(
            id = existing.id,
            createdAt = existing.createdAt,
            lastConnectedAt = existing.lastConnectedAt,
        )
    }
}
