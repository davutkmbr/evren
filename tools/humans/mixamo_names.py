"""
Names of the rider's Mixamo clips (tools/humans/mixamo.py retargets them), importable without Blender.

Run as a script, it renames the downloads in private-assets/mixamo/ (subfolders too) to the codebase's convention,
lowercase snake_case: a file of one of our clips takes our clip name ("Breathing Idle (1).fbx" -> idle.fbx), any other
its title in snake_case ("Great Sword Slash.fbx" -> great_sword_slash.fbx). Safe to run again; a name already taken gets
_2, _3 ... Nothing is overwritten.

  python3 tools/humans/mixamo_names.py [--dry-run] [folder]
"""
import os
import re
import sys

# Our clip name: loop, root motion (strip the travel and measure the speed).
CLIPS = {
    "idle": (True, False),
    "idle_look": (False, False),
    "idle_warrior": (False, False),
    "walk": (True, True),
    "run": (True, True),
    "run_stop": (False, True),
    "crouch_idle": (True, False),
    "crouch_walk": (True, True),
    "jump_start": (False, False),
    "jump_fall": (True, False),
    "jump_land": (False, False),
    "jump_land_hard": (False, False),
    "run_jump": (False, True),
    "turn_left": (False, False),
    "turn_right": (False, False),
    # Variants and transitions (the owner's picks, 2026-09-27).
    "idle_look_2": (False, False),
    "jog": (True, True),
    "walk_start": (False, True),
    "walk_turn_left": (False, True),
    "walk_turn_180": (False, True),
    "run_turn_right": (False, True),
    "run_turn_180": (False, True),
    "run_stop_quick": (False, True),
    "crouch_to_stand": (False, False),
    "fall_flail": (True, False),
    "jump_land_heavy": (False, False),
    "run_flip": (False, True),
    "run_flip_2": (False, True),
    "run_slide": (False, True),
    "turn_left_wary": (False, False),
    "turn_right_wary": (False, False),
}

# Clips that turn the body (name prefixes): their heading change is taken out and recorded (mixamo.py _unturn).
TURNING = ("turn_", "walk_turn_", "run_turn_", "crouch_to_stand")

# Mixamo titles (normalised: lowercase letters and digits only) of our clips, so files can keep their download names.
ALIASES = {
    "breathingidle": "idle",
    "idle": "idle",
    "lookingaround": "idle_look",
    "warrioridle": "idle_warrior",
    "walking": "walk",
    "running": "run",
    "runtostop": "run_stop",
    "crouchingidle": "crouch_idle",
    "crouchedwalking": "crouch_walk",
    "jumpingup": "jump_start",
    "fallingidle": "jump_fall",
    "fallingtolanding": "jump_land",
    "hardlanding": "jump_land_hard",
    "runningjump": "run_jump",
    "leftturn": "turn_left",
    "rightturn": "turn_right",
    "startwalking": "walk_start",
    "walkinglefturn": "walk_turn_left",
    "walkingturn180": "walk_turn_180",
    "runningrightturn": "run_turn_right",
    "runningturn180": "run_turn_180",
    "crouchturntostand": "crouch_to_stand",
    "falling": "fall_flail",
    "runningforwardflip": "run_flip",
    "runningslide": "run_slide",
}
# Guessed category of an extra clip, from words in its name (first match wins).
CATEGORIES = (
    ("combat", ("sword", "slash", "attack", "punch", "kick", "block", "parry", "stab", "strike", "shield", "combo",
                "draw", "sheath", "fight", "boxing", "spear", "bow", "arrow", "archer", "cast", "melee")),
    ("hit", ("hit", "death", "dying", "knock", "stun", "reaction", "impact")),
    ("dodge", ("dodge", "roll", "evade", "slide", "dive", "flip", "vault")),
    ("air", ("jump", "fall", "land", "fly", "flying", "glide", "skydiv", "hang")),
    ("climb", ("climb", "ledge", "ladder", "wall")),
    ("swim", ("swim", "tread", "water")),
    ("sit", ("sit", "kneel", "sitting", "seated", "ride", "riding", "horse", "mount")),
    ("gesture", ("wave", "salute", "bow", "point", "cheer", "clap", "talk", "yell", "shout", "greet", "look", "thinking",
                 "pray", "praying", "victory", "taunt", "nod", "shake")),
    ("crouch", ("crouch", "sneak", "stealth")),
    ("run", ("run", "sprint", "jog")),
    ("walk", ("walk", "strafe", "stroll")),
    ("turn", ("turn",)),
    ("idle", ("idle", "stand", "breath")),
    ("dance", ("dance", "dancing", "samba", "salsa", "hip hop")),
)


def _norm(s):
    return "".join(ch for ch in s.lower() if ch.isalnum())


def slug(stem):
    stem = re.sub(r"\s*\(\d+\)$", "", stem.strip())
    return re.sub(r"[^a-z0-9]+", "_", stem.lower()).strip("_") or "clip"


def resolve(stem):
    """Our clip name for a file stem: a clip name, a Mixamo title of one, else None (an extra)."""
    stem = re.sub(r"\s*\(\d+\)$", "", stem.strip())
    if stem in CLIPS:
        return stem
    return ALIASES.get(_norm(stem))


def category(name):
    words = " " + name.replace("_", " ").lower() + " "
    for cat, keys in CATEGORIES:
        if any(k in words for k in keys):
            return cat
    return "other"


def target(stem):
    """The file stem a download should have: our clip name, else its title in snake_case."""
    return resolve(stem) or slug(stem)


def main(argv):
    dry = "--dry-run" in argv
    args = [a for a in argv if not a.startswith("--")]
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    folder = args[0] if args else os.environ.get("RIDER_MIXAMO_DIR", os.path.join(root, "private-assets", "mixamo"))
    if not os.path.isdir(folder):
        print("no folder", folder)
        return 1
    moved = 0
    for dirpath, _dirs, names in os.walk(folder):
        for f in sorted(names):
            stem, ext = os.path.splitext(f)
            if ext.lower() != ".fbx":
                continue
            want = target(stem)
            if want == stem and ext == ".fbx":
                continue
            new, n = want, 2
            while os.path.exists(os.path.join(dirpath, new + ".fbx")) and (new + ".fbx") != f:
                new = f"{want}_{n}"
                n += 1
            print(f"{os.path.relpath(os.path.join(dirpath, f), folder)}  ->  {new}.fbx")
            if not dry:
                os.rename(os.path.join(dirpath, f), os.path.join(dirpath, new + ".fbx"))
            moved += 1
    print(f"{moved} file(s) {'to rename' if dry else 'renamed'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
