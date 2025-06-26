# Gestor de Citas

Este proyecto es una aplicación web para la gestión y reserva de citas en línea, desarrollada con Node.js, Express y SQLite. Permite a los usuarios agendar citas, recibir confirmación por correo electrónico (con código QR), y consultar la disponibilidad de fechas.

---

## Tabla de Contenidos
- [Características](#características)
- [Requisitos previos](#requisitos-previos)
- [Instalación](#instalación)
- [Configuración](#configuración)
- [Uso](#uso)
- [Estructura de la base de datos (UML)](#estructura-de-la-base-de-datos-uml)
- [Endpoints principales](#endpoints-principales)
- [Notas de seguridad](#notas-de-seguridad)

---

## Características
- Formulario web para agendar citas.
- Confirmación de cita por correo electrónico con código QR.
- Consulta de disponibilidad de fechas.
- Almacenamiento seguro de citas en SQLite.
- Página de confirmación con detalles de la cita.

---

## Requisitos previos
- Node.js >= 14.x
- npm >= 6.x
- Cuenta de correo (Gmail recomendado) para el envío de confirmaciones.

---

## Instalación
1. Clona el repositorio o descarga el código fuente.
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. (Opcional) Si no existe, la base de datos `appointments.db` se creará automáticamente al iniciar el servidor.

---

## Configuración
Antes de iniciar la aplicación, configura las siguientes variables de entorno para el envío de correos:

- `SENDER_EMAIL`: Tu correo de envío (ejemplo: `tucorreo@gmail.com`)
- `SENDER_PASSWORD`: Contraseña de aplicación (para Gmail con 2FA)

En Windows PowerShell puedes configurarlas así:
```powershell
$env:SENDER_EMAIL="tucorreo@gmail.com"
$env:SENDER_PASSWORD="tu_contraseña_app"
```

---

## Uso
1. Inicia el servidor:
   ```bash
   node server.js
   ```
2. Abre tu navegador y accede a [http://localhost:8080](http://localhost:8080)
3. Completa el formulario para agendar una cita.
4. Recibirás un correo de confirmación con los detalles y un código QR.
5. Puedes ver la confirmación de tu cita en la web tras agendarla.

---

## Estructura de la base de datos (UML)

La base de datos contiene una sola tabla principal:

```
appointments
-----------
id                INTEGER PRIMARY KEY AUTOINCREMENT
tramite           TEXT NOT NULL
nombres           TEXT NOT NULL
apellidos         TEXT NOT NULL
correo_electronico TEXT NOT NULL
cedula            TEXT NOT NULL
direccion         TEXT NOT NULL
institucion       TEXT NOT NULL
telefono          TEXT NOT NULL
fecha_cita        TEXT NOT NULL
confirmation_code TEXT NOT NULL
qr_id_hash        TEXT UNIQUE
qr_image_data_url TEXT NOT NULL
qr_expires_at     DATETIME NOT NULL
created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
```

---

## Endpoints principales

- `GET /`  
  Muestra el formulario para agendar una cita.

- `POST /confirmar-cita`  
  Procesa el formulario, guarda la cita, genera el QR y envía el correo de confirmación.

- `GET /cita-confirmada?id=ID`  
  Muestra la página de confirmación de la cita usando el ID real (no expone datos sensibles en la URL).

- `GET /api/available-slots?year=YYYY&month=MMMM`  
  Devuelve las fechas disponibles para agendar citas (simulado).

---

## Notas de seguridad
- **No compartas tu contraseña de correo.** Usa contraseñas de aplicación para servicios como Gmail.
- Los datos sensibles no se exponen en la URL pública.
- El servidor debe ejecutarse en un entorno seguro y actualizado.
- Considera agregar validaciones adicionales y protección contra spam/bots en producción.

---

## Autor
- Desarrollado por [Tu Nombre]

## UML de la DB

