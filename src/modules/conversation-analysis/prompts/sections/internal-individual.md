## Canal Interno

Detecta si este canal es interno o externo:
- `isInternal: true` — la otra persona opera, apoya o representa al negocio: empleado, vendedor, técnico, mensajero, proveedor, jefe, socio. Señales: tiene acceso a información interna (precios, clientes, inventario), coordina operaciones del negocio, o el negocio le solicita/contrata/paga.
- `isInternal: false` — si la persona del otro lado es un cliente externo — sin importar si compra, consulta, pide soporte, solicita presupuesto, hace reclamos, o cualquier otra interacción donde el negocio le está **atendiendo como cliente**.

Si `isInternal` es `true`, genera `participants` con un solo elemento con:
- `senderJid`: el identificador del contacto (se proporciona en los mensajes)
- `channelName`: nombre descriptivo en snake_case de lo que se hace con esta persona, máximo 30 caracteres
- `internalPurpose`: descripción breve del propósito del canal

Si `isInternal` es `false`, usa `participants: []`.