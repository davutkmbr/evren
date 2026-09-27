# Draco decoder

`draco_decoder.wasm` and `draco_wasm_wrapper.js` are copied unchanged from three.js
(`node_modules/three/examples/jsm/libs/draco/gltf/`), which vendors Google's Draco decoder (Apache License 2.0,
https://github.com/google/draco). `DRACOLoader` loads them from here to decode the Draco-compressed character meshes
(`src/dragon/model/rider/human.ts`). Refresh them from the installed three.js when upgrading it.
