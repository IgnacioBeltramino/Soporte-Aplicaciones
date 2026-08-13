import { useEffect, useRef } from 'react'

// Fondo ambiental de curvas de nivel. El campo de alturas es la suma de unas
// pocas lomas gaussianas que se mueven; de ahi salen las isolineas con el
// algoritmo de marching squares.
//
// Va en canvas 2D a proposito y no en WebGL: esta pantalla se usa por escritorio
// remoto y con la aceleracion por hardware apagada, donde WebGL directamente no
// esta. Ademas asi el fondo no arrastra ninguna dependencia.
//
// Preset "Vivo". Los tres numeros que le cambian el caracter al fondo:
//   VEL     que tan rapido se desplazan las lomas por la pantalla
//   PULSO   cuanto suben y bajan de altura (islas que nacen y desaparecen)
//   DERIVA  niveles por segundo: las curvas brotan en las cimas y se expanden
const VEL = 1.9
const PULSO = 0.3
const DERIVA = 0.1
const RIZO = 0.1

const NIVELES = 14
const NIVEL_MIN = 0.1
const NIVEL_MAX = 2.35
const PASO = (NIVEL_MAX - NIVEL_MIN) / (NIVELES - 1)

// Tope de puntos de grilla. Sin esto la grilla crece con la resolucion del
// monitor y a pantalla completa el fondo se come la CPU de una maquina de
// oficina. Con el tope el costo queda parejo en cualquier pantalla.
const CELDAS_OBJETIVO = 3500
const CELDA_MIN = 16

// 30 fps alcanzan de sobra: el movimiento es lento y asi gasta la mitad.
const FPS = 30
const MS_POR_CUADRO = 1000 / FPS

// px, py, sigma, altura, velx, vely, fase
const LOMAS = [
  [0.26, 0.30, 0.30, 1.00, 0.061, 0.043, 0.0],
  [0.72, 0.60, 0.26, 0.86, 0.047, 0.069, 1.7],
  [0.50, 0.82, 0.34, 0.70, 0.035, 0.052, 3.1],
  [0.86, 0.16, 0.22, 0.62, 0.073, 0.038, 4.4],
  [0.14, 0.72, 0.24, 0.74, 0.058, 0.081, 2.2],
]

// Cuanto se apaga el centro de la pantalla, que es donde va el contenido.
const DESPEJE = 0.7

// Blanco a --blue-light segun la altura de la curva.
function tinte(b, a) {
  const r = (250 + (145 - 250) * b) | 0
  const g = (250 + (197 - 250) * b) | 0
  return `rgba(${r},${g},255,${a.toFixed(3)})`
}

export default function FondoIsolineas() {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return

    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'

    // Si el navegador no da contexto 2D el fondo es decorativo: se sigue sin el.
    // Sin este corte la excepcion desmontaria toda la app y quedaria la pantalla
    // negra, que es lo que pasaba con la version de WebGL.
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      console.warn('FondoIsolineas: sin contexto 2D, se omite el fondo animado.')
      return
    }
    containerRef.current.appendChild(canvas)

    let ancho = 0
    let alto = 0
    let campo = null

    const medir = () => {
      ancho = window.innerWidth
      alto = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.ceil(ancho * dpr)
      canvas.height = Math.ceil(alto * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const dibujar = (t) => {
      ctx.clearRect(0, 0, ancho, alto)

      const celda = Math.max(CELDA_MIN, Math.ceil(Math.sqrt((ancho * alto) / CELDAS_OBJETIVO)))
      const cols = Math.ceil(ancho / celda) + 1
      const filas = Math.ceil(alto / celda) + 1
      if (!campo || campo.length < cols * filas) campo = new Float32Array(cols * filas)

      // Posicion, radio y altura de cada loma en este instante.
      const menor = Math.min(ancho, alto)
      const vuelta = 0.15 + Math.min(VEL, 3.2) * 0.025
      const px = []
      const py = []
      const inv = []
      const alt = []
      for (const l of LOMAS) {
        px.push((l[0] + Math.sin(t * l[4] * VEL + l[6]) * vuelta) * ancho)
        py.push((l[1] + Math.cos(t * l[5] * VEL + l[6]) * vuelta * 0.9) * alto)
        const s = l[2] * menor
        inv.push(1 / (2 * s * s))
        alt.push(l[3] * (1 - PULSO * (1 - Math.sin(t * 0.13 * VEL + l[6] * 1.6))))
      }

      // Campo de alturas.
      let i = 0
      for (let f = 0; f < filas; f++) {
        const yy = f * celda
        for (let c = 0; c < cols; c++) {
          const xx = c * celda
          let suma = 0
          for (let m = 0; m < px.length; m++) {
            const dx = xx - px[m]
            const dy = yy - py[m]
            suma += alt[m] * Math.exp(-(dx * dx + dy * dy) * inv[m])
          }
          campo[i++] = suma + RIZO * Math.sin(xx * 0.019 + yy * 0.014 + t * 0.19 * VEL)
        }
      }

      // La deriva corre todos los niveles hacia abajo, y asi las curvas brotan en
      // las cimas y se expanden. Se separa en corrida entera + fraccion para que
      // la curva indice (la mas marcada, cada 4) no pegue un salto al dar vuelta.
      const corrimiento = t * DERIVA
      const corrida = Math.floor(corrimiento)
      const frac = corrimiento - corrida

      ctx.lineWidth = 1
      ctx.lineJoin = 'round'

      for (let n = 0; n <= NIVELES; n++) {
        const nivel = NIVEL_MIN + PASO * (n - frac)
        if (nivel <= 0) continue
        const indice = ((((n + corrida) % 4) + 4) % 4) === 0
        const b = Math.min(1, n / (NIVELES - 1))

        ctx.beginPath()
        for (let f = 0; f < filas - 1; f++) {
          for (let c = 0; c < cols - 1; c++) {
            const o = f * cols + c
            const a = campo[o]
            const bb = campo[o + 1]
            const cc = campo[o + cols + 1]
            const dd = campo[o + cols]
            const caso =
              (a > nivel ? 8 : 0) | (bb > nivel ? 4 : 0) | (cc > nivel ? 2 : 0) | (dd > nivel ? 1 : 0)
            if (caso === 0 || caso === 15) continue

            const x0 = c * celda
            const y0 = f * celda
            const x1 = x0 + celda
            const y1 = y0 + celda
            // Corte interpolado sobre cada lado de la celda.
            const arriba = x0 + celda * ((nivel - a) / (bb - a))
            const der = y0 + celda * ((nivel - bb) / (cc - bb))
            const abajo = x0 + celda * ((nivel - dd) / (cc - dd))
            const izq = y0 + celda * ((nivel - a) / (dd - a))

            switch (caso) {
              case 1: ctx.moveTo(x0, izq); ctx.lineTo(abajo, y1); break
              case 2: ctx.moveTo(abajo, y1); ctx.lineTo(x1, der); break
              case 3: ctx.moveTo(x0, izq); ctx.lineTo(x1, der); break
              case 4: ctx.moveTo(arriba, y0); ctx.lineTo(x1, der); break
              case 5: ctx.moveTo(x0, izq); ctx.lineTo(arriba, y0); ctx.moveTo(abajo, y1); ctx.lineTo(x1, der); break
              case 6: ctx.moveTo(arriba, y0); ctx.lineTo(abajo, y1); break
              case 7: ctx.moveTo(x0, izq); ctx.lineTo(arriba, y0); break
              case 8: ctx.moveTo(arriba, y0); ctx.lineTo(x0, izq); break
              case 9: ctx.moveTo(arriba, y0); ctx.lineTo(abajo, y1); break
              case 10: ctx.moveTo(arriba, y0); ctx.lineTo(x1, der); ctx.moveTo(x0, izq); ctx.lineTo(abajo, y1); break
              case 11: ctx.moveTo(arriba, y0); ctx.lineTo(x1, der); break
              case 12: ctx.moveTo(x0, izq); ctx.lineTo(x1, der); break
              case 13: ctx.moveTo(abajo, y1); ctx.lineTo(x1, der); break
              case 14: ctx.moveTo(x0, izq); ctx.lineTo(abajo, y1); break
              default: break
            }
          }
        }
        ctx.strokeStyle = tinte(b * 0.8, indice ? 0.055 + b * 0.075 : 0.026 + b * 0.032)
        ctx.stroke()
      }

      // El centro se apaga: ahi va el contenido y el fondo tiene que ceder.
      ctx.globalCompositeOperation = 'destination-out'
      const g = ctx.createRadialGradient(ancho / 2, alto / 2, 0, ancho / 2, alto / 2, menor * 0.62)
      g.addColorStop(0, `rgba(0,0,0,${DESPEJE})`)
      g.addColorStop(0.55, `rgba(0,0,0,${(DESPEJE * 0.42).toFixed(3)})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, ancho, alto)
      ctx.globalCompositeOperation = 'source-over'
    }

    medir()

    // Con "reducir movimiento" activado se dibuja un solo cuadro y se corta.
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (quieto) {
      dibujar(11.6)
      const alRedimensionarQuieto = () => {
        medir()
        dibujar(11.6)
      }
      window.addEventListener('resize', alRedimensionarQuieto)
      return () => {
        window.removeEventListener('resize', alRedimensionarQuieto)
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      }
    }

    let animationId
    let ultimo = 0

    const animar = (ahora) => {
      animationId = requestAnimationFrame(animar)
      if (ahora - ultimo < MS_POR_CUADRO) return
      ultimo = ahora
      dibujar(ahora / 1000)
    }

    const alRedimensionar = () => medir()
    window.addEventListener('resize', alRedimensionar)
    animationId = requestAnimationFrame(animar)

    return () => {
      window.removeEventListener('resize', alRedimensionar)
      cancelAnimationFrame(animationId)
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
        pointerEvents: 'none',
      }}
    />
  )
}
