const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const auth = new google.auth.GoogleAuth({ 
    keyFile: 'credentials.json', 
    scopes: ['https://www.googleapis.com/auth/spreadsheets'] 
});
const SPREADSHEET_ID = '1Tq9oTlChu9IqIumy3G814-_VjYhADDKypv4_kXkLMrg';

// --- Lógica de Puntos ---
function calcularPuntos(usuario, partidos, pronosticos) {
    const userPron = pronosticos.filter(p => p[0]?.toLowerCase().trim() === usuario.toLowerCase().trim());
    return partidos.reduce((total, f) => {
        const miP = userPron.find(p => p[1] == f[0]);
        if (miP && f[5] !== "" && f[6] !== "" && miP[2] !== "" && miP[3] !== "") {
            const r1 = parseInt(f[5]), r2 = parseInt(f[6]);
            const p1 = parseInt(miP[2]), p2 = parseInt(miP[3]);
            if (r1 === p1 && r2 === p2) return total + 3; 
            if ((r1 > r2 && p1 > p2) || (r1 < r2 && p1 < p2) || (r1 === r2 && p1 === p2)) return total + 1;
        }
        return total;
    }, 0);
}

// --- Endpoints ---
app.post('/api/login', async (req, res) => {E
    const { usuario, password } = req.body;
    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Usuarios!A:B' });
    const user = (response.data.values || []).slice(1).find(f => 
        f[0]?.toLowerCase().trim() === usuario.toLowerCase().trim() && String(f[1]).trim() === String(password).trim()
    );
    res.json({ valido: !!user });
});

app.post('/api/registro', async (req, res) => {
    const { usuario, password } = req.body;
    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Usuarios!A:A' });
    const usuarios = (response.data.values || []).map(u => u[0]?.toLowerCase().trim());
    if (usuarios.includes(usuario.toLowerCase().trim())) return res.json({ success: false, message: "Usuario existente" });
    await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: 'Usuarios!A:B', valueInputOption: 'USER_ENTERED', resource: { values: [[usuario, password]] } });
    res.json({ success: true });
});

app.get('/api/ranking', async (req, res) => {
    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
    const [resU, resP, resPron] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Usuarios!A:A' }),
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Partidos!A:G' }),
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Pronosticos!A:D' })
    ]);
    const usuarios = resU.data.values?.slice(1) || [];
    const partidos = resP.data.values?.slice(1) || [];
    const pronosticos = resPron.data.values?.slice(1) || [];
    const ranking = usuarios.map(u => ({ usuario: u[0], puntos: calcularPuntos(u[0], partidos, pronosticos) })).sort((a, b) => b.puntos - a.puntos);
    res.json(ranking);
});

app.get('/api/partidos', async (req, res) => {
    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
    const [resP, resPron] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Partidos!A:G' }),
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Pronosticos!A:D' })
    ]);
    const partidos = resP.data.values?.slice(1) || [];
    const pronosticos = resPron.data.values?.slice(1) || [];
    const userQuery = req.query.usuario?.toLowerCase().trim();
    
    // Lista de partidos con puntos calculados
    const listaPartidos = partidos.map(f => {
        const miP = pronosticos.find(p => p[0]?.toLowerCase().trim() === userQuery && p[1] == f[0]);
        let pts = 0;
        if (miP && f[5] !== "" && f[6] !== "" && miP[2] !== "" && miP[3] !== "") {
            const r1 = parseInt(f[5]), r2 = parseInt(f[6]), p1 = parseInt(miP[2]), p2 = parseInt(miP[3]);
            if (r1 === p1 && r2 === p2) pts = 3; else if ((r1 > r2 && p1 > p2) || (r1 < r2 && p1 < p2) || (r1 === r2 && p1 === p2)) pts = 1;
        }
        return { id: f[0], fecha: f[1], grupo: f[2], eq1: f[3], eq2: f[4], res1: f[5] || "", res2: f[6] || "", pron1: miP ? miP[2] : "", pron2: miP ? miP[3] : "", ptsPartido: pts };
    });

    const totalUsuario = listaPartidos.reduce((sum, p) => sum + p.ptsPartido, 0);

    // Lógica de Tablas proyectadas
    const grupos = [...new Set(partidos.map(p => p[2]))];
    const tablas = {};
    grupos.forEach(g => {
        const stats = {};
        partidos.filter(p => p[2] === g).forEach(pa => {
            [pa[3], pa[4]].forEach(e => { if(!stats[e]) stats[e] = { pj:0, gf:0, gc:0, pts:0 }; });
            const miP = pronosticos.find(p => p[0]?.toLowerCase().trim() === userQuery && p[1] == pa[0]);
            if (miP && miP[2] !== "" && miP[3] !== "") {
                const p1 = parseInt(miP[2]), p2 = parseInt(miP[3]);
                stats[pa[3]].pj++; stats[pa[4]].pj++;
                stats[pa[3]].gf += p1; stats[pa[3]].gc += p2;
                stats[pa[4]].gf += p2; stats[pa[4]].gc += p1;
                if (p1 > p2) stats[pa[3]].pts += 3; else if (p2 > p1) stats[pa[4]].pts += 3; else { stats[pa[3]].pts += 1; stats[pa[4]].pts += 1; }
            }
        });
        tablas[g] = Object.keys(stats).map(n => ({ n, ...stats[n], dg: stats[n].gf - stats[n].gc })).sort((a,b) => b.pts - a.pts || b.dg - a.dg);
    });

    res.json({ partidos: listaPartidos, totalUsuario, tablas });
});

app.post('/api/guardar', async (req, res) => {
    const { usuario, idPartido, pron1, pron2 } = req.body;
    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

    try {
        // 1. Obtener la fecha del partido desde la hoja 'Partidos'
        const resPartidos = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Partidos!A:B' });
        const partidos = resPartidos.data.values || [];
        
        // Buscar el partido por ID (se asume que la primera fila es encabezado y no afectará porque no coincidirá el ID)
        const partido = partidos.find(p => p[0] == idPartido);
        
        if (!partido) {
            return res.json({ success: false, message: "Partido no encontrado." });
        }

        // 2. Validar la fecha
        const fechaPartidoStr = partido[1]; // Columna B (índice 1) tiene la fecha
        
        // Convertir la fecha. Si usas formato AAAA-MM-DD o MM/DD/AAAA en Google Sheets, esto funciona directo.
        // Si usas DD/MM/AAAA (ej: 25/06/2024), reemplaza la siguiente línea por:
        // const [dia, mes, anio] = fechaPartidoStr.split('/');
        // const fechaPartido = new Date(anio, mes - 1, dia);
        const fechaPartido = new Date(fechaPartidoStr); 
        const hoy = new Date();

        // Igualamos las horas a cero para comparar solo los días exactos
        fechaPartido.setHours(0, 0, 0, 0);
        hoy.setHours(0, 0, 0, 0);

        // Bloqueamos si la fecha actual es igual o mayor a la fecha del partido
        if (hoy >= fechaPartido) {
            return res.json({ 
                success: false, 
                message: "Ya no se pueden guardar ni modificar pronósticos el mismo día del partido o después." 
            });
        }

        // 3. Si la fecha es válida, procedemos a guardar/actualizar el pronóstico
        const resPron = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Pronosticos!A:D' });
        // Buscamos si ya existe (ignorando la fila de encabezados)
        const idx = (resPron.data.values || []).findIndex((f, i) => i > 0 && f[0]?.toLowerCase().trim() === usuario.toLowerCase().trim() && f[1] == idPartido);
        
        if (idx !== -1) {
            // Actualiza la fila existente
            await sheets.spreadsheets.values.update({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: `Pronosticos!C${idx + 1}:D${idx + 1}`, 
                valueInputOption: 'USER_ENTERED', 
                resource: { values: [[pron1, pron2]] } 
            });
        } else {
            // Añade una nueva fila
            await sheets.spreadsheets.values.append({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: 'Pronosticos!A:D', 
                valueInputOption: 'USER_ENTERED', 
                resource: { values: [[usuario, idPartido, pron1, pron2]] } 
            });
        }
        res.json({ success: true });

    } catch (error) {
        console.error("Error al guardar:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
});

app.listen(3000, () => console.log('Servidor activo en http://localhost:3000'));