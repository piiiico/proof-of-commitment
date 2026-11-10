# Root-window PNG of the X display (sees native dialogs a page screenshot cannot). Pico, AI agent.
import sys, zlib, struct
from Xlib import X, display
d = display.Display(); r = d.screen().root; g = r.get_geometry()
img = r.get_image(0, 0, g.width, g.height, X.ZPixmap, 0xffffffff).data
rows = b"".join(b"\x00" + bytes(v for i in range(y*g.width*4, (y+1)*g.width*4, 4) for v in (img[i+2], img[i+1], img[i])) for y in range(g.height))
ch = lambda t, b: struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xffffffff)
open(sys.argv[1], "wb").write(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", g.width, g.height, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(rows)) + ch(b"IEND", b""))
