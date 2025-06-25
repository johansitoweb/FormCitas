const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const qrcode = require('qrcode');
const crypto = require('crypto'); // Para generar IDs únicos y aleatorios
const { URLSearchParams } = require('url'); // Para construir URL con parámetros

const app = express();
const PORT = process.env.PORT || 8080;

// --- Database Setup ---
const db = new sqlite3.Database(path.join(__dirname, 'appointments.db'), (err) => {
    if (err) {
        console.error('Error al abrir la base de datos:', err.message);
        process.exit(1);
    }
    console.log('Conectado a la base de datos SQLite.');

    // Crea la tabla 'appointments' si no existe.
    // Se han añadido las columnas para el código de confirmación de 6 dígitos y los datos del QR.
    db.run(`
        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tramite TEXT NOT NULL,
            nombres TEXT NOT NULL,
            apellidos TEXT NOT NULL,
            correo_electronico TEXT NOT NULL,
            cedula TEXT NOT NULL,
            direccion TEXT NOT NULL,
            institucion TEXT NOT NULL,
            telefono TEXT NOT NULL,
            fecha_cita TEXT NOT NULL,             -- Formato YYYY-MM-DD
            confirmation_code TEXT NOT NULL,    -- Código de 6 dígitos
            qr_id_hash TEXT UNIQUE,             -- Hash único para el QR
            qr_image_data_url TEXT NOT NULL,    -- La imagen del QR en Data URL (Base64)
            qr_expires_at DATETIME NOT NULL,    -- Fecha de expiración del QR
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error al crear la tabla appointments:', err.message);
            process.exit(1);
        }
        console.log('Tabla appointments verificada/creada.');
    });
});

// --- Middleware ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'static')));
app.set('views', path.join(__dirname, 'views'));
app.engine('html', require('ejs').renderFile); // Usamos EJS para renderizar HTML
app.set('view engine', 'html');

// --- SMTP Configuration (USE ENVIRONMENT VARIABLES IN PRODUCTION!) ---
// Asegúrate de establecer estas variables de entorno antes de ejecutar la app:
// Por ejemplo, en CMD: set SENDER_EMAIL="tu_email@gmail.com"
//                    set SENDER_PASSWORD="tu_app_password"
// Para Gmail, usa una Contraseña de Aplicación si tienes 2FA activada.
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', // Ejemplo para Gmail
    port: 587,
    secure: false, // false para TLS, true para SSL (port 465)
    auth: {
        user: process.env.SENDER_EMAIL,
        pass: process.env.SENDER_PASSWORD,
    },
    tls: {
        rejectUnauthorized: false // Esto permite conexiones TLS con certificados autofirmados/invalidos.
                                  // Usar con precaución en producción; solo para desarrollo/pruebas.
    }
});

// Advertencia si las credenciales SMTP no están configuradas
if (!process.env.SENDER_EMAIL || !process.env.SENDER_PASSWORD) {
    console.warn("ADVERTENCIA: Las variables de entorno SENDER_EMAIL o SENDER_PASSWORD no están configuradas.");
    console.warn("El envío de correos electrónicos probablemente fallará. Por favor, configúralas.");
}

// --- Funciones Auxiliares ---

/**
 * Genera un código de confirmación aleatorio de 6 dígitos.
 * @returns {string} El código de 6 dígitos como cadena.
 */
function generateConfirmationCode() {
    // Genera un número aleatorio entre 100,000 (inclusive) y 999,999 (inclusive).
    const min = 100000;
    const max = 999999;
    return (Math.floor(Math.random() * (max - min + 1)) + min).toString();
}

/**
 * Genera un código QR con los detalles de la cita y lo devuelve como Data URL.
 * @param {object} appointment - El objeto de la cita con todos sus detalles.
 * @returns {Promise<object>} Un objeto que contiene { qrIdHash, qrImageDataUrl, qrExpiresAt }
 */
async function generateQrDataForAppointment(appointment) {
    // 1. Generar un hash único para este código QR.
    // Esto asegura que el QR sea único y nos permite identificarlo fácilmente.
    const uniqueId = crypto.randomBytes(16).toString('hex'); // 16 bytes -> 32 caracteres hex
    const qrIdHash = crypto.createHash('sha256')
                           .update(uniqueId + appointment.id + appointment.correo_electronico + Date.now())
                           .digest('hex');

    // 2. Definir la marca de tiempo de generación y la fecha de expiración del QR.
    const generatedAt = new Date();
    // La expiración es 15 minutos después de la generación.
    const qrExpiresAt = new Date(generatedAt.getTime() + 15 * 60 * 1000);

    // 3. Crear el contenido del Código QR.
    // Incluimos información clave para que al escanear, se obtengan los detalles esenciales.
    const qrContent = JSON.stringify({
        citaId: appointment.id,
        qrHash: qrIdHash,
        email: appointment.correo_electronico,
        codigo: appointment.confirmation_code, // Incluimos el código de 6 dígitos en el QR
        fechaCita: appointment.fecha_cita,
        tramite: appointment.tramite,
        institucion: appointment.institucion,
        nombres: appointment.nombres,
        apellidos: appointment.apellidos,
        generado: generatedAt.toISOString(),
        expira: qrExpiresAt.toISOString()
    });

    // 4. Generar la imagen del Código QR como una Data URL (Base64).
    // Esto permite incrustar la imagen directamente en el correo electrónico HTML.
    let qrImageDataUrl;
    try {
        qrImageDataUrl = await qrcode.toDataURL(qrContent, {
            errorCorrectionLevel: 'H', // Alto nivel de corrección de error
            type: 'image/png',
            width: 250,
            margin: 1
        });
        console.log(`QR Code generado para cita ID ${appointment.id}.`);
    } catch (err) {
        console.error('Error al generar la imagen del código QR:', err);
        throw new Error('No se pudo generar la imagen del código QR.');
    }

    return { qrIdHash, qrImageDataUrl, qrExpiresAt };
}

/**
 * Envía un correo electrónico de confirmación con los detalles de la cita y el código QR.
 * @param {object} appointment - El objeto de la cita.
 */
async function sendConfirmationEmail(appointment) {
    // Formatear la fecha de la cita para el correo electrónico.
    const dateObj = new Date(appointment.fecha_cita + 'T12:00:00'); // Añadir hora para evitar problemas de zona horaria
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = dateObj.toLocaleDateString('es-ES', options);

    // Cuerpo del correo electrónico en formato HTML.
    const mailOptions = {
        from: process.env.SENDER_EMAIL,
        to: appointment.correo_electronico,
        subject: 'Confirmación de Cita Puntos GOB',
        html: `
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px; background-color: #f9f9f9; }
                    h2 { color: #007bff; }
                    .detail-row { margin-bottom: 10px; }
                    .detail-row strong { display: inline-block; width: 150px; }
                    .code { font-size: 1.5em; font-weight: bold; color: #28a745; text-align: center; margin-top: 20px; }
                    .footer { margin-top: 30px; font-size: 0.9em; color: #777; text-align: center; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>¡Tu Cita en Puntos GOB ha sido Confirmada!</h2>
                    <p>Hola ${appointment.nombres},</p>
                    <p>Agradecemos tu confianza en nuestros servicios. Tu cita ha sido agendada con éxito.</p>

                    ${appointment.qr_image_data_url ? `<div style="text-align: center;"><img src="${appointment.qr_image_data_url}" alt="Código QR de la Cita" style="width:200px;height:200px;display:block;margin:0 auto 20px;"></div>` : ''}
                    
                    <p style="text-align: center;">Tu código de confirmación de 6 dígitos es:</p>
                    <div class="code">${appointment.confirmation_code}</div>

                    <h3>Detalles de tu Cita:</h3>
                    <div class="detail-row"><strong>Trámite:</strong> ${appointment.tramite}</div>
                    <div class="detail-row"><strong>Institución:</strong> ${appointment.institucion}</div>
                    <div class="detail-row"><strong>Fecha de la Cita:</strong> ${formattedDate}</div>
                    <div class="detail-row"><strong>Nombres:</strong> ${appointment.nombres} ${appointment.apellidos}</div>
                    <div class="detail-row"><strong>Cédula:</strong> ${appointment.cedula}</div>
                    <div class="detail-row"><strong>Correo electrónico:</strong> ${appointment.correo_electronico}</div>
                    <div class="detail-row"><strong>Teléfono:</strong> ${appointment.telefono}</div>
                    <div class="detail-row"><strong>Dirección:</strong> ${appointment.direccion}</div>

                    <p>Por favor, presenta este correo electrónico o el código de confirmación al llegar a tu cita.</p>
                    <div class="footer">
                        <p>Gracias por usar Puntos GOB. Si tienes alguna pregunta, por favor contáctanos.</p>
                    </div>
                </div>
            </body>
            </html>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Correo de confirmación enviado exitosamente a:', appointment.correo_electronico);
    } catch (error) {
        console.error('Error al enviar el correo de confirmación:', error);
        throw new Error('Falló el envío del correo electrónico.');
    }
}

// --- Rutas ---

// Sirve la página principal (formulario de agendar cita).
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Maneja el envío del formulario de confirmación de cita (POST).
app.post('/confirmar-cita', async (req, res) => {
    const {
        tramite, nombres, apellidos, correo_electronico, cedula,
        direccion, institucion, telefono, fecha_cita
    } = req.body;

    // Validación básica de los campos del formulario.
    if (!tramite || !nombres || !apellidos || !correo_electronico || !cedula ||
        !direccion || !institucion || !telefono || !fecha_cita) {
        return res.status(400).send('Por favor, complete todos los campos requeridos.');
    }

    // 1. Generar el código de confirmación de 6 dígitos.
    const confirmationCode = generateConfirmationCode();

    // Crear un objeto de cita inicial para pasar a la generación del QR y la DB.
    // El 'id' se asignará después de la inserción en la DB.
    let appointment = {
        tramite, nombres, apellidos, correo_electronico, cedula,
        direccion, institucion, telefono, fecha_cita,
        confirmation_code: confirmationCode
    };

    let qrDetails;
    try {
        // 2. Generar los datos del QR (hash, Data URL y fecha de expiración).
        // Se pasa un ID de cita temporal (0) que será actualizado después de la inserción,
        // ya que el QR se genera antes de que la cita tenga un ID real en la DB.
        // El contenido real del QR usará el ID de la cita final.
        qrDetails = await generateQrDataForAppointment({ ...appointment, id: 0 }); // Usar un ID temporal para el QR inicial.
        // Después de la inserción, actualizaremos el QR con el ID real si es necesario o confiaremos en el hash.
    } catch (qrError) {
        console.error('Error al generar datos del QR:', qrError);
        return res.status(500).send('Error interno del servidor al generar el código QR.');
    }

    // Actualizar el objeto appointment con los detalles del QR.
    appointment.qr_id_hash = qrDetails.qrIdHash;
    appointment.qr_image_data_url = qrDetails.qrImageDataUrl;
    appointment.qr_expires_at = qrDetails.qrExpiresAt.toISOString(); // Guardar como string ISO

    // 3. Insertar la cita (con código de 6 dígitos y datos del QR) en la base de datos.
    const sql = `INSERT INTO appointments (tramite, nombres, apellidos, correo_electronico, cedula, direccion, institucion, telefono, fecha_cita, confirmation_code, qr_id_hash, qr_image_data_url, qr_expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(sql, [
        appointment.tramite, appointment.nombres, appointment.apellidos,
        appointment.correo_electronico, appointment.cedula, appointment.direccion,
        appointment.institucion, appointment.telefono, appointment.fecha_cita,
        appointment.confirmation_code, appointment.qr_id_hash,
        appointment.qr_image_data_url, appointment.qr_expires_at
    ], function(err) { // Usar 'function' para acceder a 'this.lastID'
        if (err) {
            console.error('Error al insertar la cita en la base de datos:', err.message);
            return res.status(500).send('Error interno del servidor al guardar la cita.');
        }

        // Obtener el ID de la cita recién insertada.
        appointment.id = this.lastID;
        console.log(`Cita guardada en la DB con ID: ${appointment.id}`);

        // Opcional: Re-generar el QR si el `citaId` en el QR es crítico y debe ser el real.
        // Esto haría el proceso un poco más lento pero más preciso en el QR.
        // Por ahora, asumimos que el `qrIdHash` es suficiente para la unicidad en el QR y el `citaId` real solo es de referencia.
        // Si el `citaId` dentro del QR debe ser el real:
        // try {
        //     const updatedQrDetails = await generateQrDataForAppointment(appointment);
        //     appointment.qr_image_data_url = updatedQrDetails.qr_image_data_url;
        //     // También podrías actualizar la DB aquí con el nuevo QR si el `qr_image_data_url` cambió
        //     // o si el `qrIdHash` se actualizó (lo cual no debería si el QR es el mismo contenido).
        // } catch (qrUpdateError) {
        //     console.error('Advertencia: Error al actualizar QR con ID real:', qrUpdateError);
        //     // Continuar, ya que el QR inicial es funcional.
        // }


        // 4. Enviar el correo electrónico de confirmación de forma asíncrona.
        sendConfirmationEmail(appointment)
            .catch(emailError => {
                console.error('Error al enviar el correo (manejo asíncrono):', emailError);
                // Aquí podrías implementar reintentos o un sistema de colas.
            });

        // 5. Redirigir a la página de confirmación con los detalles de la cita.
        const queryParams = new URLSearchParams({
            tramite: appointment.tramite,
            nombres: appointment.nombres,
            apellidos: appointment.apellidos,
            correo_electronico: appointment.correo_electronico,
            cedula: appointment.cedula,
            direccion: appointment.direccion,
            institucion: appointment.institucion,
            telefono: appointment.telefono,
            fecha_cita: appointment.fecha_cita,
            confirmation_code: appointment.confirmation_code,
            qr_image_data_url: appointment.qr_image_data_url, // Pasar QR para mostrarlo en la confirmación
            id: appointment.id // Pasar el ID de la cita
        }).toString();
        res.redirect(`/cita-confirmada?${queryParams}`);
    });
});

// Sirve la página de confirmación de cita, mostrando los detalles.
app.get('/cita-confirmada', (req, res) => {
    // req.query contiene los parámetros de la URL pasados desde la redirección.
    res.render('confirmation.html', req.query);
});

// API endpoint para obtener franjas horarias disponibles (simuladas).
app.get('/api/available-slots', (req, res) => {
    const { year, month } = req.query;

    if (!year || !month) {
        return res.status(400).json({ error: 'Missing year or month parameter' });
    }

    const availableDates = new Set();
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth(); // 0-indexed

    const parsedYear = parseInt(year);
    const monthNames = ["january", "february", "march", "april", "may", "june",
                        "july", "august", "september", "october", "november", "december"];
    const parsedMonth = monthNames.indexOf(month.toLowerCase());

    if (parsedMonth === -1) {
        return res.status(400).json({ error: 'Invalid month parameter' });
    }

    const daysInMonth = new Date(parsedYear, parsedMonth + 1, 0).getDate();

    for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(parsedYear, parsedMonth, i);
        date.setHours(0, 0, 0, 0); // Normalizar a inicio del día

        const today = new Date();
        today.setHours(0,0,0,0);
        if (date < today) {
            continue; // Saltar fechas pasadas
        }

        // Simula disponibilidad: 10, 15, 20, 24, 28 de cada mes y el día siguiente al actual.
        if (date.getDate() === 10 || date.getDate() === 15 || date.getDate() === 20 || date.getDate() === 24 || date.getDate() === 28) {
             availableDates.add(date.toISOString().split('T')[0]); // Formato YYYY-MM-DD
        }

        if (date.getFullYear() === currentYear && date.getMonth() === currentMonth && date.getDate() === currentDate.getDate() + 1) {
            availableDates.add(date.toISOString().split('T')[0]);
        }
    }

    res.json({ availableDates: Array.from(availableDates).sort() });
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor de Citas Puntos GOB ejecutándose en http://localhost:${PORT}`);
});