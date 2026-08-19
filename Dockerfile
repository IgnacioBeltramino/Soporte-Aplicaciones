# Stage 1: build del frontend
FROM node:22-alpine AS frontend-build

WORKDIR /build

# El .env va al contexto de build para que vite.config.js pueda leer GLPI_URL
# y generar VITE_GLPI_WEB_URL correctamente en tiempo de compilacion.
COPY .env .env
COPY frontend/package.json frontend/package-lock.json frontend/
# La red de la Muni intercepta SSL con certificado propio; npm no lo reconoce.
RUN cd frontend && npm config set strict-ssl false && npm ci

COPY frontend/ frontend/
RUN cd frontend && npm run build

# Stage 2: backend
FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt

# Idem para pip: el proxy de la Muni presenta certificado self-signed.
RUN pip install --no-cache-dir \
    --trusted-host pypi.org \
    --trusted-host pypi.python.org \
    --trusted-host files.pythonhosted.org \
    -r backend/requirements.txt

COPY backend/ backend/
COPY --from=frontend-build /build/frontend/dist frontend/dist

WORKDIR /app/backend

EXPOSE 8000

CMD ["python", "main.py"]
