## Canal Interno

Este canal YA fue identificado como interno. No necesitas determinar si es interno o no — `isInternal` es `true`.

Tu tarea es determinar el propósito de este canal individual. Analiza cómo interactúa el negocio con esta persona y genera `participants` con un solo elemento con:
- `senderJid`: el identificador del contacto (se proporciona en los mensajes)
- `channelName`: nombre descriptivo en snake_case de lo que se hace con esta persona, máximo 30 caracteres
- `internalPurpose`: descripción breve del propósito del canal