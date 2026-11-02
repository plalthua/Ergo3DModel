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
    this.bindings = null;
    this.bindingStatus = 'No articulated local model loaded.';
  }

  async load(url, progress) {
    const gltf = await new GLTFLoader().loadAsync(url, progress);
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    if (bounds.isEmpty() || ![...bounds.min, ...bounds.max].every(Number.isFinite)) {
      throw new Error('The GLB has no finite visible geometry.');
    }
    const bindings = this.bindArticulation(gltf.scene);
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
    this.bindings = bindings;
    const doorMaterials = new Map();
    gltf.scene.traverse((object) => {
      const sourceName = object.userData.rigSource?.name || object.name;
      const sideDoor = object.isMesh && /^Door_(Front|Rear)_(Interior|Exterior)_(LH|RH)_/.test(sourceName);
      if (sideDoor) {
        const clone = (material) => {
          if (!doorMaterials.has(material)) doorMaterials.set(material, material.clone());
          return doorMaterials.get(material);
        };
        object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
      }
      const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
      for (const material of materials) {
        this.materials.set(material, {
          opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite,
          sideDoor,
        });
      }
    });
    this.bounds = bounds;
    return gltf;
  }

  bindArticulation(scene) {
    const definition = this.definition.articulation;
    const assemblies = definition && [
      ...Object.values(definition.panels).flatMap((panel) => panel.nodes),
      definition.steering.column_node,
    ];
    const meshes = definition && [...definition.island_meshes, ...definition.steering.meshes];
    if (!definition || assemblies.some((name) => !scene.getObjectByName(name)) ||
      meshes.some(({ name, vertices }) => {
        const node = scene.getObjectByName(name);
        return !node?.isMesh || !node.geometry.index || Array.isArray(node.material) ||
          node.geometry.attributes.position.count !== vertices;
      })) {
      this.bindingStatus = 'Static GLB: assembly signature not matched; no articulation or ergonomic alignment enabled.';
      console.warn(this.bindingStatus);
      return null;
    }
    scene.updateMatrixWorld(true);
    const makePivot = (name, position) => {
      const pivot = new THREE.Group();
      pivot.name = name;
      pivot.position.fromArray(position);
      scene.add(pivot);
      pivot.updateMatrixWorld(true);
      return pivot;
    };
    const panels = Object.fromEntries(Object.entries(definition.panels).map(([id, panel]) => {
      const pivot = makePivot(`estimated_GLB_${id}_hinge`, panel.pivot);
      for (const name of panel.nodes) pivot.attach(scene.getObjectByName(name));
      return [id, { pivot, open: false, axis: new THREE.Vector3(...panel.axis).normalize() }];
    }));
    const seat = makePivot('estimated_GLB_driver_seat', definition.seat.pivot);
    const back = makePivot('estimated_GLB_driver_back', definition.seat.back_pivot);
    const cushion = makePivot('estimated_GLB_driver_cushion', definition.seat.cushion_pivot);
    seat.attach(back);
    seat.attach(cushion);
    const mirrors = Object.fromEntries(Object.entries(definition.mirrors).map(([id, mirror]) => {
      const pivot = makePivot(`estimated_GLB_mirror_${id}`, mirror.pivot);
      if (mirror.panel) panels[mirror.panel].pivot.attach(pivot);
      return [id, pivot];
    }));
    const targets = {
      ...Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id, panel.pivot])),
      seat_base: seat, seat_back: back, seat_cushion: cushion,
      ...Object.fromEntries(Object.entries(mirrors).map(([id, pivot]) => [`mirror_${id}`, pivot])),
    };
    for (const mesh of definition.island_meshes) {
      const destinations = new Map();
      for (const [target, seeds] of Object.entries(mesh.parts)) {
        for (const seed of seeds) {
          if (destinations.has(seed)) throw new Error(`Duplicate GLB island binding: ${mesh.name}:${seed}`);
          destinations.set(seed, target);
        }
      }
      const found = new Set();
      this.splitIslands(scene, scene.getObjectByName(mesh.name), (island) => {
        const target = destinations.get(island.seed);
        if (target) found.add(island.seed);
        return target;
      }, targets);
      for (const seed of destinations.keys()) {
        if (!found.has(seed)) throw new Error(`Missing GLB island: ${mesh.name}:${seed}`);
      }
    }
    const wheel = makePivot('estimated_GLB_steering_spin', definition.steering.pivot);
    const steering = definition.steering;
    const axis = new THREE.Vector3(...steering.axis).normalize();
    const center = new THREE.Vector3(...steering.pivot);
    for (const mesh of steering.meshes) {
      const count = this.splitIslands(scene, scene.getObjectByName(mesh.name), (island) =>
        island.points.some((point) => point.clone().sub(center).dot(axis) >= steering.moving_island_axial_max_min)
          ? 'wheel' : undefined, { wheel });
      if (!count) throw new Error(`No rotating steering islands found in ${mesh.name}`);
    }
    const length = this.car.spec.steering.pivot_to_wheel_mm.value / this.definition.units_to_mm;
    const column = makePivot('estimated_GLB_column_tilt', center.clone().addScaledVector(axis, -length).toArray());
    const telescope = makePivot('estimated_GLB_column_telescope', column.position.toArray());
    column.attach(telescope);
    telescope.attach(scene.getObjectByName(steering.column_node));
    telescope.attach(wheel);
    this.bindingStatus = 'Geometry-derived estimates: all doors, tailgate, frunk lid, door-mounted mirrors, driver seat and steering articulate. Human/optical metrics use the GLB-aligned estimate profile, not validated hardpoints.';
    return {
      panels, seat, back, cushion, mirrors, column, telescope, wheel, wheelAxis: axis,
      seatRest: seat.position.clone(),
    };
  }

  splitIslands(scene, node, classify, targets) {
    const geometry = node.geometry, position = geometry.attributes.position, index = geometry.index;
    const parents = Array.from({ length: position.count }, (_, i) => i);
    const root = (i) => {
      while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
      return i;
    };
    const union = (a, b) => { parents[root(a)] = root(b); };
    const welded = new Map(), point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i);
      const key = point.toArray().map((v) => Math.round(v / this.definition.articulation.weld_tolerance)).join(',');
      if (welded.has(key)) union(i, welded.get(key));
      else welded.set(key, i);
    }
    for (let i = 0; i < index.count; i += 3) {
      union(index.getX(i), index.getX(i + 1));
      union(index.getX(i), index.getX(i + 2));
    }
    const islands = new Map();
    for (let i = 0; i < position.count; i++) {
      const id = root(i);
      if (!islands.has(id)) islands.set(id, { seed: i, points: [] });
      point.fromBufferAttribute(position, i);
      islands.get(id).points.push(scene.worldToLocal(node.localToWorld(point.clone())));
    }
    const routes = new Map([...islands].map(([id, island]) => [id, classify(island)]));
    const partitions = new Map();
    for (let i = 0; i < index.count; i += 3) {
      const route = routes.get(root(index.getX(i)));
      if (!partitions.has(route)) partitions.set(route, []);
      partitions.get(route).push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
    const sourceName = node.name, originalParent = node.parent;
    let moved = 0;
    for (const [route, indices] of partitions) {
      const part = node.clone();
      part.name = route ? `${sourceName}__${route}` : sourceName;
      const vertices = [...new Set(indices)], lookup = new Map(vertices.map((v, i) => [v, i]));
      const compact = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const ArrayType = (attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array).constructor;
        const output = new THREE.BufferAttribute(new ArrayType(vertices.length * attribute.itemSize),
          attribute.itemSize, attribute.normalized);
        for (let i = 0; i < vertices.length; i++) {
          for (let c = 0; c < attribute.itemSize; c++) output.setComponent(i, c, attribute.getComponent(vertices[i], c));
        }
        compact.setAttribute(name, output);
      }
      compact.setIndex(indices.map((i) => lookup.get(i)));
      compact.computeBoundingBox();
      compact.computeBoundingSphere();
      part.geometry = compact;
      part.userData.rigSource = { name: sourceName, vertices };
      originalParent.add(part);
      if (route) { targets[route].attach(part); moved++; }
    }
    originalParent.remove(node);
    geometry.dispose();
    return moved;
  }

  supportsOpening(id) {
    return !!this.bindings?.panels[id];
  }

  openingIsOpen(id) {
    return this.bindings?.panels[id]?.open === true;
  }

  get hasOpenPanels() {
    return !!this.bindings && Object.values(this.bindings.panels).some((panel) => panel.open);
  }

  setOpening(id, open) {
    if (!this.supportsOpening(id) || typeof open !== 'boolean') throw new Error(`Unbound GLB opening: ${id}`);
    const panel = this.bindings.panels[id];
    panel.open = open;
    panel.pivot.quaternion.setFromAxisAngle(panel.axis,
      open ? THREE.MathUtils.degToRad(this.definition.articulation.panels[id].open_angle_deg) : 0);
  }

  update(state) {
    if (this.bindings) {
      const spec = this.car.spec, rig = this.bindings, definition = this.definition.articulation;
      const channels = ['seat_x', 'seat_z', 'seat_back_angle', 'seat_cushion_tilt',
        'steer_tilt', 'steer_telescope', 'steer_wheel_angle',
        ...Object.keys(rig.mirrors).flatMap((id) => [`mirror_${id}_yaw`, `mirror_${id}_pitch`])];
      if (channels.some((channel) => !Number.isFinite(state[channel]))) {
        throw new Error('GLB adjustments must all be finite.');
      }
      const rad = THREE.MathUtils.degToRad, units = this.definition.units_to_mm;
      rig.seat.position.copy(rig.seatRest).add(new THREE.Vector3(state.seat_x / units,
        (state.seat_z - state.seat_x * Math.tan(rad(spec.seat.rail_angle_deg.value))) / units, 0));
      const seatAxis = new THREE.Vector3(...definition.seat.axis);
      rig.back.quaternion.setFromAxisAngle(seatAxis, rad(state.seat_back_angle - spec.seat.back_angle_deg.design));
      rig.cushion.quaternion.setFromAxisAngle(seatAxis,
        rad(state.seat_cushion_tilt - spec.seat.cushion_tilt_deg.design));
      rig.column.rotation.z = rad(state.steer_tilt - spec.steering.tilt_deg.design);
      rig.telescope.position.copy(rig.wheelAxis).multiplyScalar(
        (state.steer_telescope - spec.steering.telescope_mm.design) / units);
      rig.wheel.quaternion.setFromAxisAngle(rig.wheelAxis,
        rad(state.steer_wheel_angle - spec.steering.wheel_angle_deg.design));
      const normal = (yaw, pitch) => new THREE.Vector3(
        Math.cos(rad(pitch)) * Math.cos(rad(yaw)), Math.sin(rad(pitch)),
        -Math.cos(rad(pitch)) * Math.sin(rad(yaw)));
      for (const [id, pivot] of Object.entries(rig.mirrors)) {
        const rest = spec.mirrors[id];
        pivot.quaternion.setFromUnitVectors(normal(rest.yaw_deg.design, rest.pitch_deg.design),
          normal(state[`mirror_${id}_yaw`], state[`mirror_${id}_pitch`]));
      }
    }
  }

  inspect(enabled) {
    for (const [material, original] of this.materials) {
      const transparentDoor = enabled && original.sideDoor;
      material.opacity = transparentDoor
        ? Math.min(original.opacity, this.car.spec.visual_reconstruction.inspection_transparency.value.door_opacity)
        : original.opacity;
      material.transparent = transparentDoor || original.transparent;
      material.depthWrite = transparentDoor ? false : original.depthWrite;
      material.needsUpdate = true;
    }
  }
}
