import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class ImportedCar {
  constructor(car, definition) {
    this.car = car;
    this.definition = definition;
    this.layer = car.layer('imported_vehicle');
    this.layer.visible = false;
    this.model = null;
    this.materials = new Map();
  }

  async load(url, progress) {
    const gltf = await new GLTFLoader().loadAsync(url, progress);
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    if (bounds.isEmpty() || ![...bounds.min, ...bounds.max].every(Number.isFinite)) {
      throw new Error('The GLB has no finite visible geometry.');
    }
    if (this.model) {
      this.layer.remove(this.model);
      this.model.traverse((object) => {
        object.geometry?.dispose();
        const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
        for (const material of materials) {
          for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
          material.dispose();
        }
      });
    }
    this.materials.clear();
    const alignment = new THREE.Group();
    alignment.name = 'supplied_GLB_estimated_vehicle_alignment';
    alignment.rotation.x = Math.PI / 2;
    alignment.scale.setScalar(this.definition.units_to_mm);
    alignment.position.fromArray(this.definition.translation_mm);
    alignment.add(gltf.scene);
    this.layer.add(alignment);
    this.model = alignment;
    gltf.scene.traverse((object) => {
      const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
      for (const material of materials) {
        this.materials.set(material, {
          opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite,
        });
      }
    });
    this.bounds = bounds;
    return gltf;
  }

  inspect(enabled) {
    for (const [material, original] of this.materials) {
      material.opacity = enabled ? Math.min(original.opacity, 0.18) : original.opacity;
      material.transparent = enabled || original.transparent;
      material.depthWrite = enabled ? false : original.depthWrite;
      material.needsUpdate = true;
    }
  }
}
