# Press one key on the X display via XTEST (answers Chromium's native permission dialog in a test profile). Pico, AI agent.
import sys, time
from Xlib import X, XK, display
from Xlib.ext import xtest
d = display.Display()
for name in sys.argv[1:]:
    code = d.keysym_to_keycode(XK.string_to_keysym(name))
    xtest.fake_input(d, X.KeyPress, code); d.sync(); time.sleep(0.05)
    xtest.fake_input(d, X.KeyRelease, code); d.sync(); time.sleep(0.3)
