package com.nexterm.ui

import com.nexterm.claude.ChatMessage
import com.nexterm.claude.ChatRole
import java.awt.*
import javax.swing.*

class ChatMessageRenderer : ListCellRenderer<ChatMessage> {

    private val panel = JPanel(BorderLayout()).apply {
        border = BorderFactory.createEmptyBorder(6, 8, 6, 8)
    }
    private val roleLabel = JLabel().apply {
        font = font.deriveFont(Font.BOLD, 11f)
    }
    private val textArea = JTextArea().apply {
        lineWrap = true
        wrapStyleWord = true
        isEditable = false
        isOpaque = false
        font = UIManager.getFont("Label.font")?.deriveFont(13f) ?: Font("Monospaced", Font.PLAIN, 13)
        border = BorderFactory.createEmptyBorder(2, 0, 0, 0)
    }

    init {
        panel.add(roleLabel, BorderLayout.NORTH)
        panel.add(textArea, BorderLayout.CENTER)
    }

    override fun getListCellRendererComponent(
        list: JList<out ChatMessage>,
        value: ChatMessage,
        index: Int,
        isSelected: Boolean,
        cellHasFocus: Boolean,
    ): Component {
        roleLabel.text = if (value.role == ChatRole.USER) "you" else "claude"
        roleLabel.foreground = if (value.role == ChatRole.USER)
            UIManager.getColor("Label.foreground") ?: Color.WHITE
        else
            Color(100, 180, 100)

        textArea.text = value.content

        if (value.role == ChatRole.USER) {
            panel.isOpaque = true
            panel.background = UIManager.getColor("EditorPane.background") ?: Color(42, 42, 42)
        } else {
            panel.isOpaque = false
        }

        // Force correct height calculation for variable-height cells
        val width = list.width
        if (width > 0) {
            textArea.setSize(width - 16, Short.MAX_VALUE.toInt())
            val prefHeight = roleLabel.preferredSize.height + textArea.preferredSize.height + 12
            panel.preferredSize = Dimension(width, prefHeight)
        }

        return panel
    }
}
