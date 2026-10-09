import * as THREE from 'three';
import { COLOR, ENVIRONMENT, LIGHTS } from '../../design-system/scene';
import { PARALLAX } from '../../design-system/motion';
import type { Settings } from './settings';

const KEY = new THREE.Vector3(...LIGHTS.key.position);
const RIM = new THREE.Vector3(...LIGHTS.rim.position);
const FILL = new THREE.Vector3(...LIGHTS.rimFill.position);

/** Three directional lights plus an environment baked from five emissive cards (reflections are the primary light). */
export class Lighting {
  key = new THREE.DirectionalLight(LIGHTS.key.color, LIGHTS.key.intensity);
  rim = new THREE.DirectionalLight(LIGHTS.rim.color, LIGHTS.rim.intensity);
  rimFill = new THREE.DirectionalLight(LIGHTS.rimFill.color, LIGHTS.rim.intensity * LIGHTS.rimFill.intensityOfRim);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    scene.background = new THREE.Color(COLOR.background);
    scene.environment = this.bake(renderer);
    this.key.position.copy(KEY);
    this.rim.position.copy(RIM);
    this.rimFill.position.copy(FILL);
    scene.add(this.key, this.key.target, this.rim, this.rim.target, this.rimFill, this.rimFill.target);
  }

  private bake(renderer: THREE.WebGLRenderer) {
    const cards = new THREE.Scene();
    cards.background = new THREE.Color(0);
    const plane = new THREE.PlaneGeometry(1, 1);
    for (const c of ENVIRONMENT.cards) {
      const m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: new THREE.Color(c.color).multiplyScalar(c.intensity), side: THREE.DoubleSide }));
      m.position.set(...(c.position as [number, number, number]));
      m.scale.set(c.width, c.height, 1);
      m.lookAt(0, 0, 0);
      cards.add(m);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(cards, ENVIRONMENT.sigma).texture;
    pmrem.dispose();
    plane.dispose();
    return env;
  }

  update(pointer: THREE.Vector2, scene: THREE.Scene, s: Settings) {
    this.key.intensity = s.keyIntensity;
    this.key.position.set(KEY.x + pointer.x * PARALLAX.keyLight.x, KEY.y + pointer.y * PARALLAX.keyLight.y, KEY.z);
    this.rim.intensity = s.rimIntensity;
    this.rim.position.set(RIM.x + pointer.x * PARALLAX.rimLight.x, RIM.y + pointer.y * PARALLAX.rimLight.y, RIM.z);
    this.rimFill.intensity = s.rimIntensity * LIGHTS.rimFill.intensityOfRim;
    scene.environmentIntensity = s.environmentIntensity;
  }
}
