import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const backendPort = env.BACKEND_PORT || '8000'
  const frontendPort = parseInt(env.FRONTEND_PORT) || 5173

  // La URL web de GLPI sale del mismo GLPI_URL del .env que usa el backend, sin
  // el /apirest.php del final. Misma cuenta que glpi_client.py, para que el
  // dominio este declarado en un solo lugar y no hardcodeado en cada pagina.
  const glpiWebUrl = (env.GLPI_URL || '').split('/apirest.php')[0]

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_GLPI_WEB_URL': JSON.stringify(glpiWebUrl),
    },
    server: {
      port: frontendPort,
      proxy: {
        '/api': `http://localhost:${backendPort}`,
      },
    },
  }
})
