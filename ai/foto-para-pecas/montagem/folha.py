# folha.py — junta as fotos do juiz numa folha numerada: python folha.py saida/juiz/mala
import sys, os, json
from PIL import Image, ImageDraw
d = sys.argv[1]
lista = json.load(open(os.path.join(d, 'lista.json'), encoding='utf-8'))
T = 220; cols = 5; rows = (len(lista) + cols - 1) // cols
out = Image.new('RGB', (cols * T, rows * (T + 20)), 'white'); dr = ImageDraw.Draw(out)
for i, x in enumerate(lista):
    if not os.path.exists(x['foto']): continue
    im = Image.open(x['foto']).convert('RGB'); im.thumbnail((T - 8, T - 8))
    cx, cy = (i % cols) * T, (i // cols) * (T + 20)
    out.paste(im, (cx + 4, cy + 20)); dr.text((cx + 4, cy + 4), str(x['n']), fill='red')
out.save(os.path.join(d, 'folha.png')); print(out.size)
