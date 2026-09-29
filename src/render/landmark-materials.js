import * as THREE from 'three';

let materials;
export function landmarkMaterials() {
  if (materials) return materials;
  const load = name => {
    const texture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/${name}`);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  const facade = new THREE.MeshStandardMaterial({
    name: 'Generated limestone facade', map: load('rooftop-building-facade-v1.png'),
    roughness: .85, color: 0xc4c4c4,
  });
  const paving = load('rooftop-limestone-v1.png');
  const floor = new THREE.MeshStandardMaterial({
    name: 'Generated rooftop paving', map: paving, bumpMap: paving, bumpScale: .012,
    roughness: .92, color: 0xb9b9b9,
  });
  return materials = [facade, floor];
}
