"""Shared helpers for the rider human pipeline (Blender + MPFB 2, headless). See build_rider.py."""
import importlib
import sys

import bpy


def enable_mpfb():
    """Enables the MPFB extension (installed in user_default) under --factory-startup."""
    mod = "bl_ext.user_default.mpfb"
    if mod not in bpy.context.preferences.addons:
        bpy.ops.preferences.addon_enable(module=mod)


def mpfb(path, name):
    """Imports a symbol from the MPFB extension package (extension imports are relative)."""
    for amod in list(sys.modules):
        if amod.endswith(path):
            return getattr(importlib.import_module(amod), name)
    raise ImportError(f"MPFB module {path} not loaded")


def args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
