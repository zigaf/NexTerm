package com.nexterm.claude

class TerminalOutputBuffer(private val maxSize: Int = 5000) {
    private val buffer = StringBuilder()

    @Synchronized
    fun append(text: String) {
        buffer.append(text)
        if (buffer.length > maxSize) {
            buffer.delete(0, buffer.length - maxSize)
        }
    }

    @Synchronized
    fun getContent(): String = buffer.toString()

    @Synchronized
    fun clear() = buffer.setLength(0)
}
