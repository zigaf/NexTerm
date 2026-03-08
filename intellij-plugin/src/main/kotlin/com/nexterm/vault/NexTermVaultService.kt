package com.nexterm.vault

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.components.*
import com.nexterm.model.ServerConnection
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import java.security.SecureRandom
import java.util.Base64

@Service(Service.Level.APP)
@State(name = "NexTermVault", storages = [Storage("nexterm.xml")])
class NexTermVaultService : PersistentStateComponent<NexTermVaultService.State> {

    private val gson = Gson()
    private var _state = State()
    private val serverCache = mutableMapOf<String, ServerConnection>()

    data class State(
        var serverIds: MutableList<String> = mutableListOf(),
        var serverMeta: MutableMap<String, String> = mutableMapOf(), // id -> JSON (no secrets)
    )

    override fun getState() = _state
    override fun loadState(state: State) { _state = state }

    // ── Public API ─────────────────────────────────────────────

    fun saveServer(server: ServerConnection) {
        // Store sensitive values in PasswordSafe (OS keychain)
        server.variables.forEach { variable ->
            saveSecret("nexterm.${server.id}.${variable.id}", variable.value)
        }
        if (server.password != null) {
            saveSecret("nexterm.${server.id}.password", server.password)
        }
        if (server.passphrase != null) {
            saveSecret("nexterm.${server.id}.passphrase", server.passphrase)
        }
        server.jumpHost?.password?.let { jumpPwd ->
            saveSecret("nexterm.${server.id}.jumpHost.password", jumpPwd)
        }

        // Store non-sensitive meta in XML state (strip secrets)
        val jumpHostMeta = server.jumpHost?.copy(password = null)
        val meta = server.copy(
            password = null,
            passphrase = null,
            jumpHost = jumpHostMeta,
            variables = server.variables.map { it.copy(value = "***") },
        )
        val isNew = server.id !in _state.serverIds
        _state.serverMeta[server.id] = gson.toJson(meta)
        if (isNew) _state.serverIds.add(server.id)

        // Invalidate cache
        serverCache[server.id] = server
    }

    fun getServer(id: String): ServerConnection? {
        serverCache[id]?.let { return it }

        val json = _state.serverMeta[id] ?: return null
        val server = gson.fromJson(json, ServerConnection::class.java)

        // Restore secret values from PasswordSafe
        val password = getSecret("nexterm.${server.id}.password")
        val passphrase = getSecret("nexterm.${server.id}.passphrase")
        val variables = server.variables.map { variable ->
            val secret = getSecret("nexterm.${server.id}.${variable.id}")
            variable.copy(value = secret ?: "")
        }
        val jumpHostPassword = getSecret("nexterm.${server.id}.jumpHost.password")
        val jumpHost = if (jumpHostPassword != null && server.jumpHost != null) {
            server.jumpHost.copy(password = jumpHostPassword)
        } else server.jumpHost
        val full = server.copy(password = password, passphrase = passphrase, jumpHost = jumpHost, variables = variables)
        serverCache[id] = full
        return full
    }

    fun getAllServers(): List<ServerConnection> {
        return _state.serverIds.mapNotNull { getServer(it) }
    }

    /** Returns server metadata from XML state without touching the OS keychain.
     *  Suitable for list display where secrets are not needed. */
    fun getAllServersMeta(): List<ServerConnection> {
        return _state.serverIds.mapNotNull { id ->
            val json = _state.serverMeta[id] ?: return@mapNotNull null
            gson.fromJson(json, ServerConnection::class.java)
        }
    }

    fun deleteServer(id: String) {
        val server = getServer(id)
        server?.variables?.forEach { variable ->
            deleteSecret("nexterm.${id}.${variable.id}")
        }
        deleteSecret("nexterm.${id}.password")
        deleteSecret("nexterm.${id}.passphrase")
        deleteSecret("nexterm.${id}.jumpHost.password")
        _state.serverIds.remove(id)
        _state.serverMeta.remove(id)
        serverCache.remove(id)
    }

    // ── Settings (API keys) ───────────────────────────────────

    fun saveApiKey(key: String) {
        saveSecret("nexterm.anthropic.api_key", key)
    }

    fun getApiKey(): String? {
        return getSecret("nexterm.anthropic.api_key")
    }

    // ── PasswordSafe (OS keychain) ─────────────────────────────

    private fun saveSecret(key: String, value: String) {
        val attrs = CredentialAttributes("NexTerm", key)
        PasswordSafe.instance.set(attrs, Credentials(key, value))
    }

    private fun getSecret(key: String): String? {
        val attrs = CredentialAttributes("NexTerm", key)
        return PasswordSafe.instance.getPassword(attrs)
    }

    private fun deleteSecret(key: String) {
        val attrs = CredentialAttributes("NexTerm", key)
        PasswordSafe.instance.set(attrs, null)
    }
}
