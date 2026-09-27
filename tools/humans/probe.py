import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mpfb import enable_mpfb, mpfb
enable_mpfb()
HumanService = mpfb("mpfb.services.humanservice", "HumanService")
b = HumanService.create_human()
print("BASEMESH", b.name, len(b.data.vertices), [m.type for m in b.modifiers], b.dimensions[:])
rig = HumanService.add_builtin_rig(b, "mixamo")
print("RIG", rig.name, len(rig.data.bones), [bn.name for bn in rig.data.bones][:70])
