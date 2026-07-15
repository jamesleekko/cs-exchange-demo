"""Export the Blender forge as a web-ready, animated GLB.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender \
    --background /path/to/cs2_forge.blend \
    --python scripts/export-furnace.py -- public/models/cs2-forge.glb

The source .blend is never saved. All compatibility changes only live in the
background Blender process used for export.
"""

import sys
from pathlib import Path

import bpy


def output_path():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) != 1:
        raise SystemExit("Expected one output .glb path after --")
    return Path(args[0]).expanduser().resolve()


def principled(material):
    if not material or not material.use_nodes:
        return None
    return next(
        (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
        None,
    )


def set_input(shader, names, value):
    for name in names:
        socket = shader.inputs.get(name)
        if socket:
            socket.default_value = value
            if socket.is_linked:
                for link in list(socket.links):
                    shader.id_data.links.remove(link)
            return


def make_materials_gltf_compatible():
    # Blender's procedural Noise/ColorRamp/Bump network is not representable in
    # glTF. These neutral PBR values are deterministic export fallbacks; the web
    # renderer applies the final shared PBR palette by material name.
    presets = {
        "M_DarkSteel": ((0.018, 0.024, 0.034, 1.0), 0.92, 0.34),
        "M_BrushedSteel": ((0.16, 0.19, 0.23, 1.0), 0.96, 0.24),
        "M_ArmorPanel": ((0.055, 0.065, 0.082, 1.0), 0.90, 0.31),
        "M_GripRubber": ((0.012, 0.015, 0.020, 1.0), 0.10, 0.58),
        "M_PlaqueLetter": ((0.36, 0.40, 0.46, 1.0), 0.82, 0.22),
    }
    for name, (color, metallic, roughness) in presets.items():
        shader = principled(bpy.data.materials.get(name))
        if not shader:
            continue
        set_input(shader, ("Base Color",), color)
        set_input(shader, ("Metallic",), metallic)
        set_input(shader, ("Roughness",), roughness)
        set_input(shader, ("Normal",), (0.0, 0.0, 0.0))


def convert_text_to_mesh():
    for obj in list(bpy.data.objects):
        if obj.type != "FONT":
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.hide_set(False)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target="MESH")


def add_fx_anchor():
    old = bpy.data.objects.get("FX_Mouth")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    anchor = bpy.data.objects.new("FX_Mouth", None)
    anchor.location = (0.0, 0.0, 0.62)
    bpy.context.scene.collection.objects.link(anchor)
    base = bpy.data.objects.get("Base_Root")
    if base:
        anchor.parent = base
    return anchor


def select_export_objects(anchor):
    bpy.ops.object.select_all(action="DESELECT")
    allowed_collections = {"FORGE_GEO", "FORGE_RIG"}
    selected = []
    for obj in bpy.context.scene.objects:
        in_allowed = any(collection.name in allowed_collections for collection in obj.users_collection)
        if (in_allowed and obj.name != "Ground") or obj == anchor:
            obj.hide_set(False)
            obj.hide_viewport = False
            obj.hide_render = False
            obj.select_set(True)
            selected.append(obj)
    return selected


def main():
    destination = output_path()
    destination.parent.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 303
    scene.frame_set(1)
    make_materials_gltf_compatible()
    convert_text_to_mesh()
    anchor = add_fx_anchor()
    selected = select_export_objects(anchor)

    if not bpy.data.objects.get("Base_Root") or not bpy.data.objects.get("Furnace_Root"):
        raise RuntimeError("Required Base_Root/Furnace_Root nodes are missing")

    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_animations=True,
        export_animation_mode="SCENE",
        export_frame_range=True,
        export_frame_step=1,
        export_force_sampling=True,
        export_bake_animation=True,
        export_anim_scene_split_object=False,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_object=True,
    )
    print(f"FURNACE_GLTF={destination}")
    print(f"FURNACE_EXPORT_OBJECTS={len(selected)}")


if __name__ == "__main__":
    main()
