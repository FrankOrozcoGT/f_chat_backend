## Canal Interno (Grupo)

Esta es una conversación de grupo. Detecta si este grupo es interno o externo:
- `isInternal: true` — los participantes operan, apoyan o representan al negocio: empleados, vendedores, técnicos, mensajeros, proveedores, jefes, socios. Señales: tienen acceso a información interna (precios, clientes, inventario), coordinan operaciones del negocio, o el negocio les solicita/contrata/paga.
- `isInternal: false` — si los participantes son clientes externos.

Si `isInternal` es `true`:
- Genera `channelName` para el grupo: nombre descriptivo en snake_case, máximo 30 caracteres
- Genera `internalPurpose` para el grupo: descripción breve del propósito del grupo
- Genera `participants`: un elemento por cada participante con el que el negocio interactúa directamente. **Mínimo 1 participante obligatorio.** Cada uno con:
  - `senderJid`: el identificador del participante (aparece en los mensajes)
  - `channelName`: nombre descriptivo en snake_case de lo que se hace con esa persona, máximo 30 caracteres
  - `internalPurpose`: descripción breve del rol de esa persona
- Participantes con los que el negocio NO interactúa directamente no se incluyen en `participants`

Si `isInternal` es `false`, usa `channelName: null`, `internalPurpose: null`, `participants: []`.