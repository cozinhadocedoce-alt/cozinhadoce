// Fotos: reduz no aparelho antes de enviar (mais rápido e sem os dados de localização da câmera,
// que somem ao redesenhar a imagem no canvas).

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Foto HEIC do iPhone em navegador que não abre o formato: converte antes.
    if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '')) {
      const { default: heic2any } = await import('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm');
      const jpg = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      return createImageBitmap(Array.isArray(jpg) ? jpg[0] : jpg);
    }
    // Último recurso: <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

const canvasBlob = (canvas, type, quality) => new Promise((resolve, reject) =>
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível ler a foto.'))), type, quality));

// Foto do doce: lado maior com até `max` pixels, JPEG.
export async function resizePhoto(file, max = 1600, quality = 0.85) {
  const img = await decode(file);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasBlob(canvas, 'image/jpeg', quality);
}

// Ícone do app: recorte quadrado do centro, PNG.
export async function squareIcon(file, size) {
  const img = await decode(file);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return canvasBlob(canvas, 'image/png');
}

export const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});
