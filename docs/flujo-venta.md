# Flujo de Venta - Guia Interna

## Nodos del flujo

### NODO ROUTER (saludo + deteccion de intencion)
- Cliente saluda
- Manda lo que quiere ("necesito X cartucho o toner")
- Se detecta que va por venta (si va por otro flujo → HITL + notificacion al usuario + registro)
- Si es despedida → template de despedida, cierra sesion
- Si escribe cortesia post-despedida → ignorar
- Si es nueva intencion post-despedida → nueva conversacion

### NODO VERIFICACION CONVERSACION ANTERIOR
- Se activa cuando el router detecta que el mensaje podria referirse a una conversacion anterior cerrada
- Busca la conversacion anterior del mismo cliente (la mas reciente cerrada)
- Analiza si el mensaje del cliente tiene relacion con esa conversacion (ej: "y cuando me llega?", "me mandas la factura?")
- Si tiene relacion → reabre la conversacion anterior con su contexto y reenvía al nodo correspondiente para procesamiento
- Si no tiene relacion → devuelve al router para que procese como conversacion nueva
- Centraliza la query: un solo SELECT con joins para obtener conversacion anterior + mensajes + estado del flujo
- El nodo solo decide (reabrir o ignorar), la logica de queries esta en el orquestador/dispatcher

### NODO IDENTIFICACION + PRECIO
- Se busca en los equipos del cliente (modelo + precio manejado)
- Si tiene 3+ productos similares → ofrecer juego
- Se ofrecen productos conocidos del cliente
- Si el producto no existe → se genera un registro CRM para que el usuario pueda actualizar precios + notificar al usuario con info del cliente para que nos de el precio, cuando lo recibamos seguimos la conversacion con el cliente
- Se da precio al cliente (IVA ya incluido en el precio)
- Acepta → sigue
- Negocia → pasa al nodo negociacion
- Rechaza → registro de perdida + HITL + notificacion al usuario
- Se da total al cliente
- Se pregunta si se envia o pasa por el producto
  - Quetzaltenango ciudad → sin costo
  - Fuera → cobro de envio (transporte urbano o Guatex)
- Se recalcula total si hay costo de envio

### NODO NEGOCIACION
- Cliente nuevo (sin historial) → HITL directo + notificacion al usuario
- Cliente conocido → usar memoria especial del cliente (patron de negociacion, margenes que acepta, como negocia en conversaciones anteriores) para predecir y seguir el juego
- Acepta → sigue
- No se llega a acuerdo → registro de perdida + HITL + notificacion al usuario

### NODO FACTURACION / DESPACHO (puede activarse en cualquier momento)
- Se manda al usuario un mensaje de que se hizo venta o se necesita factura, favor mandar foto
- Se espera la foto del usuario
- La foto se manda al grupo tecnico para despacho
- Si hay factura:
  - Se solicita NIT (si no lo tenemos)
  - Se encola solicitud de factura al sistema de colas (destino: ventas/contadora): NIT + que se esta vendiendo lo mas especifico posible + precio + total
  - Cuando la cola retorna la factura → se la manda al cliente

### NODO COBRO + VERIFICACION
- Se solicita deposito, transferencia o visa link
- Si es visa link → tiene otro costo → HITL + notificacion al usuario
- Recordatorios configurables (por ahora 3pm, 5pm, 9am):
  - Se envian al cliente si ya pasaron 2 horas del ultimo contacto y toca recordatorio
  - Solo si no se han enviado 3 recordatorios ya
  - Si se pasan los 3 recordatorios → se notifica al usuario para que decida y este informado + se toma como perdida
- Cliente envia comprobante
- Se envia comprobante al WA personal del usuario
- Usuario puede aceptar o mandar correcciones → se modifica y se vuelve a enviar para confirmacion
- Se envia al grupo de verificacion
- Se espera "confirmado" de la supervisora (filtrar por remitente, el grupo tiene mas personas)
- Supervisora siempre manda el mensaje que se le envio con el recibo y la palabra "confirmado"
- Si no se paso por facturacion/despacho antes → se pasa ahora

### NODO DECISOR (hardcodeado en LangGraph, no customizable)
- Se activa cuando una transición entre nodos falla (transición no configurada o inválida)
- Lee los TODOs/requisitos de cada nodo del flow actual
- Con base en los requisitos de cada nodo y la conversación del usuario, decide:
  - Ir a un nodo específico del flow (el que mejor corresponda según los TODOs)
  - Salir del flow (exitFlow → router)
  - Ir a HITL
- Es un nodo interno del sistema, no aparece como nodo configurable para el usuario
- Aplica a todos los flows, no es específico de venta

### Nota: SystemPrompt como TODOs
- Los nodos customizables usan formato TODO en su systemPrompt: el usuario define qué debe lograr el nodo y sus reglas como items de checklist
- El LLM del nodo verifica los TODOs antes de transicionar
- El nodo decisor puede leer estos TODOs de todos los nodos del flow para decidir a cuál ir

---

## Regla General: Notificaciones al usuario
- Siempre que se mande a HITL → notificar al usuario
- Siempre que un cliente nuevo inicie conversacion y este en HITL → notificar al usuario
- Siempre que se necesite atencion del usuario → notificar
- El usuario puede estar tranquilo, nosotros le avisamos cuando se requiera

## Memoria Especial del Cliente (para negociacion)
- Patron de negociacion: siempre negocia? cuanto baja normalmente?
- Margenes que acepta
- Historial de como negocia en conversaciones anteriores
- Permite que la IA maneje la negociacion con clientes conocidos sin pasar a HITL

## Sistema de Colas (independiente de los nodos)
- Cada cola esta asociada a un WhatsApp especifico
- Recibe solicitudes de cualquier nodo/flujo de cualquier sesion
- Envia una solicitud a la vez al WhatsApp destino
- Espera respuesta antes de enviar la siguiente
- Cuando llega respuesta en ese WhatsApp → identifica a que flujo/sesion pertenece → devuelve resultado al nodo que encolo
- Pueden existir multiples colas (una por cada WhatsApp destino)
- Futuro: logica de matching cuando hay multiples solicitudes en cola y la respuesta no es obvia a quien pertenece
