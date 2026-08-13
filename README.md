# Dashboard Soporte Aplicaciones - v1.0

Dashboard interno de monitoreo para GLPI, desarrollado para el equipo de Soporte Aplicaciones del Municipio de San Miguel.

---
## Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/IgnacioBeltramino/dashboard-glpi
cd dashboard-soporteApp
````

### 2. Configurar variables de entorno

Copiar el archivo de ejemplo:

````
cp .env.example .env
````

Crear el .env y remplazar en el mismo las credenciales solicitadas

**IMPORTANTE:**
En el ".env.example" pide lo siguiente: 

BACKEND_PORT=
FRONTEND_PORT=

- Si los dejas vacios el programa inicia (de forma local) en los siguientes puertos: (8000 y 5173) 
- Si eliminar esas dos lineas del .env inicia en: (8000 y 5173)
- Si pones otros puertos, inicia en los que fijes. 
### 3. Instalar dependencias

cd backend
pip install -r requirements.txt

cd ../frontend
npm install

---
## Ejecución

### Backend

cd backend
python main.py

### Frontend (en otra terminal)

cd frontend
npm run dev

Acceder en: http://localhost:5173 (o el FRONTEND_PORT configurado en el .env)

---
Notas

- .env contiene credenciales sensibles y nunca debe subirse al repositorio