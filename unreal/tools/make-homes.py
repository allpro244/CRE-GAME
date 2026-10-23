# AMERICAN HOUSES, BY ERA (HouseBuilder.cpp instances them on the region's and the
# towns' house lots). Real-size whole-house meshes, front to +Y, centred on the
# origin, ground at Z 0; the builder fits each to its footprint (within about a
# quarter either way) and recolours it per instanced component through the kit's
# eight named slots (kitlib.py):
#   wall    siding, brick or stucco          roof    asphalt shingles
#   trim    window and corner trim, porch     fabric  masonry: chimney, foundation, wainscot
#   accent  front door, shutters              metal   garage door
#   glass, dark                               (dark: window frames on the modern farmhouse)
#
#   SM_HK_Bungalow     1905-35  1.5 storey, front gable, full-width porch on brick piers
#   SM_HK_Foursquare   1900-30  2 storey cube, hip roof, front dormer, full-width porch
#   SM_HK_Cape         1935-55  1.5 storey, steep side gable, two dormers
#   SM_HK_Ranch(_R)    1946-75  1 storey, long and low, hip roof, attached garage at one end
#   SM_HK_RanchGable(_R)        the same under a side gable, brick wainscot
#   SM_HK_SplitLevel(_R) 1955-80  two-storey half over the garage, one-storey half raised
#   SM_HK_Colonial(_R) 1975-2005  2 storey, side gable, shutters, portico, two-car garage wing
#   SM_HK_Farmhouse(_R) 2005-    board and batten, steep gables, a front gable wing, black windows, metal porch roof
#   SM_HK_Garage       a detached one-car garage (pre-war lots, out back)
# _R: mirrored (the garage on the other end).
#
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="<this>"
import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import unreal
from kitlib import box, gable, hip, prism, save, tinted, fg, WALL, TRIM, METAL, GLASS, FABRIC, ACCENT, DARK, ROOF

ROOT = "/Game/BW/Homes"
MATS = ROOT + "/Mats"

# ------------------------------------------------------------------ colours
C = {}
for name, folder, parent, rgb in [
    # siding (painted lap siding reads as the panel paint's fine lines)
    ("SidingWhite", "Paint", "PaintedMetal_White", (0.95, 0.94, 0.90)),
    ("SidingCream", "Paint", "PaintedMetal_White", (0.93, 0.86, 0.70)),
    ("SidingYellow", "Paint", "PaintedMetal_White", (0.92, 0.80, 0.50)),
    ("SidingBlue", "Paint", "PaintedMetal_White", (0.55, 0.64, 0.72)),
    ("SidingGrey", "Paint", "PaintedMetal_White", (0.62, 0.62, 0.60)),
    ("SidingGreen", "Paint", "PaintedMetal_White", (0.55, 0.62, 0.50)),
    ("SidingTan", "Paint", "PaintedMetal_White", (0.74, 0.65, 0.52)),
    ("SidingSlate", "Paint", "PaintedMetal_White", (0.32, 0.36, 0.40)),
    ("Stucco", "Paint", "PaintedStone_White", (0.92, 0.86, 0.74)),
    # asphalt shingles (a finely coursed dark brick reads as shingles from the air)
    ("ShingleCharcoal", "Brick", "BrickOffset_Brown", (0.42, 0.41, 0.40)),
    ("ShingleBrown", "Brick", "BrickOffset_Brown", (0.62, 0.50, 0.40)),
    ("ShingleGrey", "Brick", "BrickOffset_Brown", (0.58, 0.58, 0.58)),
    ("ShingleGreen", "Brick", "BrickOffset_Brown", (0.42, 0.50, 0.42)),
    ("ShingleRed", "Brick", "BrickOffset_Brown", (0.62, 0.36, 0.30)),
    # doors and shutters
    ("DoorRed", "Paint", "PaintedMetal_White", (0.50, 0.06, 0.06)),
    ("DoorBlack", "Paint", "PaintedMetal_White", (0.05, 0.05, 0.05)),
    ("DoorNavy", "Paint", "PaintedMetal_White", (0.06, 0.10, 0.24)),
    ("DoorGreen", "Paint", "PaintedMetal_White", (0.06, 0.22, 0.12)),
    ("Black", "Paint", "PaintedMetal_White", (0.04, 0.04, 0.045)),
]:
    C[name] = tinted(MATS, "MI_HK_" + name, folder, parent, rgb)
BRICK_RED = fg("Brick", "BrickOffset_Red")
SLOTS = {
    "wall": C["SidingWhite"], "trim": fg("Paint", "PaintedStone_White"), "metal": fg("Paint", "PaintedMetal_White"),
    "glass": "/Game/Building/Material/MI/Glass/MI_Bldg_glass_opaque.MI_Bldg_glass_opaque", "fabric": BRICK_RED,
    "accent": C["DoorRed"], "dark": C["Black"], "roof": C["ShingleCharcoal"],
}


class House:
    """One house under construction, mirrored in X when s = -1."""

    def __init__(self, s=1):
        self.m = unreal.DynamicMesh()
        self.s = s

    def X(self, x):
        return self.s * x

    def box(self, mid, x0, x1, y0, y1, z0, z1):
        box(self.m, mid, self.X(x0), self.X(x1), y0, y1, z0, z1)

    def walls(self, x0, x1, y0, y1, z0, z1, found=45):
        """A wall block with its foundation showing below (masonry)."""
        self.box(WALL, x0, x1, y0, y1, max(z0, found), z1)
        self.box(FABRIC, x0 - 3, x1 + 3, y0 - 3, y1 + 3, z0, found)
        # corner boards
        for x in (x0, x1):
            for y in (y0, y1):
                self.box(TRIM, x - 6, x + 6, y - 6, y + 6, found, z1)

    def window(self, face, c, z0, z1, w, y=None, frame=TRIM, shutters=False, panes=True):
        """A window on a face ('f' +Y, 'b' -Y, 'l' -X, 'r' +X) of the block whose face is at `y` (a Y for f/b, an X for l/r)."""
        t = 5
        if face in ("f", "b"):
            sgn = 1 if face == "f" else -1
            y0, y1 = (y, y + sgn * t) if sgn > 0 else (y + sgn * t, y)
            self.box(frame, c - w / 2 - 8, c + w / 2 + 8, y0, y1, z0 - 10, z1 + 8)          # casing
            self.box(GLASS, c - w / 2, c + w / 2, y0 + sgn * 1 if sgn > 0 else y0 - 1, y1 + sgn * 1, z0, z1)
            if panes:
                self.box(frame, c - 2.5, c + 2.5, min(y0, y1 + sgn * 2), max(y0, y1 + sgn * 2), z0, z1)
                self.box(frame, c - w / 2, c + w / 2, min(y0, y1 + sgn * 2), max(y0, y1 + sgn * 2), (z0 + z1) / 2 - 2.5, (z0 + z1) / 2 + 2.5)
            self.box(TRIM, c - w / 2 - 12, c + w / 2 + 12, y0, y1 + sgn * 4, z0 - 14, z0 - 8)   # sill
            if shutters:
                for side in (-1, 1):
                    xs = c + side * (w / 2 + 30)
                    self.box(ACCENT, xs - 20, xs + 20, y0, y1 + sgn * 2, z0 - 6, z1 + 4)
        else:
            sgn = 1 if face == "r" else -1
            xw = y
            x0, x1 = (xw, xw + sgn * t)
            self.box(frame, x0, x1, c - w / 2 - 8, c + w / 2 + 8, z0 - 10, z1 + 8)
            self.box(GLASS, x0, x1 + sgn * 1, c - w / 2, c + w / 2, z0, z1)
            self.box(TRIM, x0, x1 + sgn * 4, c - w / 2 - 12, c + w / 2 + 12, z0 - 14, z0 - 8)

    def door(self, c, y, w=95, h=210, glass_side=False):
        self.box(TRIM, c - w / 2 - 12, c + w / 2 + 12, y, y + 5, 0, h + 14)
        self.box(ACCENT, c - w / 2, c + w / 2, y + 2, y + 8, 40, h)
        self.box(METAL, c + w / 2 - 22, c + w / 2 - 14, y + 7, y + 11, 125, 135)    # knob
        self.box(TRIM, c - w / 2 - 30, c + w / 2 + 30, y, y + 90, 0, 40)            # stoop

    def garage_door(self, x0, x1, y, h=215):
        self.box(TRIM, x0 - 12, x1 + 12, y, y + 4, 0, h + 12)
        self.box(METAL, x0, x1, y + 2, y + 7, 0, h)
        for z in range(55, int(h), 53):                                               # panel joints
            self.box(TRIM, x0, x1, y + 6, y + 8, z, z + 3)
        self.box(DARK, x0 + 10, x1 - 10, y + 6, y + 8, h - 45, h - 25)                # the glazed top row

    def porch(self, x0, x1, y0, y1, posts, deck=55, top=280, roof="shed", rise=90):
        self.box(TRIM, x0, x1, y0, y1, 0, deck)
        for x in posts:
            self.box(TRIM, x - 11, x + 11, y1 - 30, y1 - 8, deck, top)
        self.box(TRIM, x0, x1, y1 - 30, y1 - 8, top - 22, top)                        # the beam
        self.box(TRIM, x0, x1, y1 - 26, y1 - 22, deck + 75, deck + 85)               # rail
        if roof == "shed":
            prism(self.m, ROOF, [(y0, top + rise), (y1 + 30, top), (y1 + 30, top + 12), (y0, top + rise + 12)], self.X(x0) if self.s > 0 else self.X(x1), self.X(x1) if self.s > 0 else self.X(x0), "x")
        elif roof == "metal":
            prism(self.m, DARK, [(y0, top + rise), (y1 + 30, top), (y1 + 30, top + 8), (y0, top + rise + 8)], self.X(x0) if self.s > 0 else self.X(x1), self.X(x1) if self.s > 0 else self.X(x0), "x")
        else:
            hip(self.m, ROOF, self.X(x0) if self.s > 0 else self.X(x1), self.X(x1) if self.s > 0 else self.X(x0), y0, y1, top, rise, over=20)

    def gable(self, x0, x1, y0, y1, z, rise, axis="x", over=40):
        a, b = sorted((self.X(x0), self.X(x1)))
        gable(self.m, WALL, ROOF, a, b, y0, y1, z, rise, over=over, axis=axis)

    def hip(self, x0, x1, y0, y1, z, rise, over=50):
        a, b = sorted((self.X(x0), self.X(x1)))
        hip(self.m, ROOF, a, b, y0, y1, z, rise, over)

    def chimney(self, x, y, top):
        self.box(FABRIC, x - 40, x + 40, y - 45, y + 45, 0, top)
        self.box(TRIM, x - 46, x + 46, y - 51, y + 51, top, top + 12)

    def save(self, name, slots=None):
        s = dict(SLOTS)
        if slots:
            s.update(slots)
        save(self.m, ROOT, name, s)


def bungalow():
    # 10 m wide, 13 m deep: the body behind a 3 m porch under its own shed roof
    h = House()
    h.walls(-500, 500, -650, 350, 0, 300)
    h.gable(-500, 500, -650, 350, 300, 330, axis="y")
    h.porch(-500, 500, 350, 650, [-470, -160, 160, 470], top=270, roof="shed", rise=70)
    for x in (-470, 470):
        h.box(FABRIC, x - 22, x + 22, 620, 645, 55, 140)   # the porch posts' brick piers
    h.door(-170, 350)
    h.window("f", 200, 110, 240, 150, y=350)
    h.window("f", 180, 450, 540, 70, y=-650 + 1000, panes=False)   # the attic window in the gable
    for c in (-450, -150, 150):
        h.window("l", c, 110, 240, 90, y=-500)
        h.window("r", c, 110, 240, 90, y=500)
    h.window("b", -200, 110, 240, 90, y=-650)
    h.window("b", 200, 130, 220, 60, y=-650)
    h.chimney(-520, -250, 700)
    h.save("SM_HK_Bungalow")


def foursquare():
    h = House()
    h.walls(-500, 500, -500, 260, 0, 580)
    h.hip(-500, 500, -500, 260, 580, 300)
    # the front dormer
    h.box(WALL, -110, 110, 40, 250, 600, 760)
    h.gable(-110, 110, 40, 250, 760, 80, axis="y", over=15)
    h.window("f", 0, 640, 730, 120, y=250, panes=False)
    h.porch(-500, 500, 260, 500, [-480, -160, 160, 480], top=290, roof="hip", rise=70)
    h.door(-230, 260)
    h.window("f", 230, 110, 250, 110, y=260)
    for c in (-260, 260):
        h.window("f", c, 360, 500, 100, y=260)
    for c in (-300, 50):
        for z0, z1 in ((110, 250), (360, 500)):
            h.window("l", c, z0, z1, 100, y=-500)
            h.window("r", c, z0, z1, 100, y=500)
    for c in (-250, 250):
        h.window("b", c, 360, 500, 100, y=-500)
        h.window("b", c, 110, 250, 100, y=-500)
    h.chimney(520, -150, 1000)
    h.save("SM_HK_Foursquare")


def cape():
    h = House()
    h.walls(-550, 550, -400, 400, 0, 280)
    h.gable(-550, 550, -400, 400, 280, 380, axis="x")
    for x in (-300, 300):   # dormers on the front slope
        h.box(WALL, x - 85, x + 85, 120, 330, 300, 470)
        h.gable(x - 85, x + 85, 120, 330, 470, 70, axis="y", over=12)
        h.window("f", x, 340, 450, 90, y=330, panes=False)
    h.door(0, 400)
    h.box(TRIM, -90, 90, 400, 480, 230, 245)    # a little hood over the door
    for x in (-330, 330):
        h.window("f", x, 100, 230, 110, y=400, shutters=True)
    for c in (-200, 200):
        h.window("l", c, 100, 230, 90, y=-550)
        h.window("r", c, 100, 230, 90, y=550)
    h.window("l", 0, 380, 470, 70, y=-550, panes=False)
    h.window("b", -250, 100, 230, 110, y=-400)
    h.window("b", 250, 140, 220, 70, y=-400)
    h.chimney(580, 0, 760)
    h.save("SM_HK_Cape")


def ranch(s, gabled, suf=""):
    # 15 m: the house 10 m, the garage 5 m at the +X end set back 1 m
    h = House(s)
    h.walls(-750, 250, -450, 450, 0, 270)
    h.walls(250, 750, -450, 350, 0, 270)
    if gabled:
        h.gable(-750, 750, -450, 450, 270, 220, axis="x", over=50)
        h.box(FABRIC, -750, 250, 450, 458, 45, 105)    # the brick wainscot across the front
    else:
        h.hip(-750, 750, -450, 450, 270, 190, over=60)
    h.garage_door(320, 680, 350)
    h.door(-450, 450)
    h.window("f", -100, 100, 220, 260, y=450)           # the picture window
    h.window("f", -650, 120, 220, 100, y=450, shutters=True)
    h.window("f", 130, 150, 220, 90, y=450)
    for c in (-250, 150):
        h.window("l", c, 120, 220, 100, y=-750)
    for c in (-600, -300, 0):
        h.window("b", c, 120, 220, 100, y=-450)
    h.chimney(-120, -100, 560)
    h.save(("SM_HK_RanchGable" if gabled else "SM_HK_Ranch") + suf)


def splitlevel(s, suf=""):
    h = House(s)
    # the two-storey half over the garage (front gable), the one-storey half raised half a level
    h.walls(-700, -100, -450, 450, 0, 520)
    h.gable(-700, -100, -450, 450, 520, 200, axis="y")
    h.walls(-100, 700, -450, 400, 0, 380)
    h.gable(-100, 700, -450, 400, 380, 170, axis="x")
    h.garage_door(-620, -180, 450, h=205)
    h.window("f", -400, 320, 460, 160, y=450)
    h.door(80, 400, h=250)
    h.box(TRIM, 30, 130, 400, 520, 0, 120)              # steps up to the door
    h.window("f", 420, 190, 310, 220, y=400)
    for c in (-300, 200):
        h.window("b", c, 300, 440, 100, y=-450)
    h.window("l", 0, 320, 460, 100, y=-700)
    h.window("r", 0, 190, 310, 100, y=700)
    h.save("SM_HK_SplitLevel" + suf)


def colonial(s, suf=""):
    h = House(s)
    # the house 9 m wide with a two-car garage wing (front gable) set back
    h.walls(-650, 250, -450, 450, 0, 560)
    h.gable(-650, 250, -450, 450, 560, 300, axis="x")
    h.walls(250, 650, -450, 330, 0, 300)
    h.gable(250, 650, -450, 330, 300, 200, axis="y")
    h.garage_door(275, 625, 330, h=220)
    h.door(-200, 450)
    # a portico on two columns
    for x in (-310, -90):
        h.box(TRIM, x - 10, x + 10, 560, 580, 40, 280)
    h.box(TRIM, -330, -70, 450, 600, 0, 40)
    gable(h.m, TRIM, ROOF, *sorted((h.X(-330), h.X(-70))), 450, 600, 280, 70, over=15, axis="y")
    for x in (-500, 70):
        h.window("f", x, 110, 250, 100, y=450, shutters=True)
    for x in (-500, -200, 70):
        h.window("f", x, 370, 500, 100, y=450, shutters=True)
    for c in (-250, 250):
        h.window("l", c, 110, 250, 100, y=-650)
        h.window("l", c, 370, 500, 100, y=-650)
    for c in (-450, -100):
        h.window("b", c, 370, 500, 100, y=-450)
        h.window("b", c, 110, 250, 100, y=-450)
    h.chimney(-690, 0, 960)
    h.save("SM_HK_Colonial" + suf)


def farmhouse(s, suf=""):
    h = House(s)
    # board and batten (vertical battens over the wall), black frames, steep gables
    h.walls(-650, 300, -450, 250, 0, 560)
    h.gable(-650, 300, -450, 250, 560, 420, axis="x", over=30)
    h.walls(-650, -150, 250, 450, 0, 560)
    h.gable(-650, -150, 250, 450, 560, 330, axis="y", over=30)
    for x in range(-640, 300, 40):
        h.box(WALL, x - 2, x + 2, 250, 254, 45, 560)
    h.porch(-150, 300, 250, 450, [-130, 120, 280], top=280, roof="metal", rise=60)
    h.walls(300, 650, -450, 250, 0, 300)
    h.gable(300, 650, -450, 250, 300, 160, axis="x", over=30)
    h.garage_door(340, 610, 250, h=220)
    h.door(80, 250)
    h.window("f", -400, 110, 300, 120, y=450, frame=DARK)
    h.window("f", -400, 370, 500, 100, y=450, frame=DARK)
    h.window("f", -50, 130, 300, 80, y=250, frame=DARK, panes=False)
    h.window("f", 200, 380, 500, 100, y=250, frame=DARK)
    for c in (-250, 100):
        h.window("l", c, 110, 300, 100, y=-650, frame=DARK)
        h.window("b", c, 370, 500, 100, y=-450, frame=DARK)
    h.save("SM_HK_Farmhouse" + suf)


def garage():
    h = House()
    h.walls(-300, 300, -325, 325, 0, 260, found=20)
    h.gable(-300, 300, -325, 325, 260, 150, axis="y", over=25)
    h.garage_door(-140, 140, 325, h=210)
    h.window("l", 0, 120, 200, 70, y=-300, panes=False)
    h.save("SM_HK_Garage")


bungalow()
foursquare()
cape()
for s, suf in ((1, ""), (-1, "_R")):
    ranch(s, False, suf)
    ranch(s, True, suf)
    splitlevel(s, suf)
    colonial(s, suf)
    farmhouse(s, suf)
garage()
