/** Floppy materials. Values follow docs/reference-floppy/00-floppy-reference.md §3. */
import * as THREE from 'three';
import { GLASS } from '../../../design-system/scene';
import { brushedTextures, circularAnisotropy, faceDecal, linerTexture, paperNormals, ringNormals, stippleTexture } from './textures';
import { CASE } from './spec';

export interface GlassUniforms { uEdgeColor: { value: THREE.Color }; uEdgeGlow: { value: number }; uGlassOpacity: { value: number } }

/** Reference "smoked glass": no diffuse, no direct light, edge emissive, alpha from tint and angle, premultiplied blend. */
export function glassMaterial(uniforms: GlassUniforms) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: GLASS.metalness, roughness: GLASS.roughness, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const lightsWithoutDirect = THREE.ShaderChunk.lights_fragment_begin.replaceAll('&& defined( RE_Direct )', '&& 0');
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uEdgeColor; uniform float uEdgeGlow; uniform float uGlassOpacity;`)
      .replace('#include <lights_fragment_begin>', lightsWithoutDirect)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 glassTint = diffuseColor.rgb;
diffuseColor.rgb = vec3(0.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ float facing = abs(dot(normal, normalize(vViewPosition)));
  totalEmissiveRadiance += uEdgeColor * glassTint * (pow(1.0 - facing, 4.0) + 0.015) * uEdgeGlow; }`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
{ float facing = abs(dot(normal, normalize(vViewPosition)));
  float smoke = 1.0 - dot(glassTint, vec3(1.0 / 3.0));
  gl_FragColor.a = clamp(uGlassOpacity + pow(1.0 - facing, 5.0) * 0.5 + smoke * 0.75, 0.0, 1.0); }`);
  };
  return m;
}

/**
 * Moulded ABS. Per-vertex aSurf = (occlusion, roughness scale, stipple strength): pockets darken, recesses are
 * smoother than the stippled faces, edges carry no stipple.
 */
export function absMaterial(stipple: THREE.Texture, decal: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.46, metalness: 0, normalMap: stipple, normalScale: new THREE.Vector2(0.75, 0.75) });
  const uDirect = { value: 0.5 };
  m.userData.uDirect = uDirect; // direct-light specular scale (tunable)
  m.onBeforeCompile = (s) => {
    s.uniforms.uDecal = { value: decal };
    s.uniforms.uDirect = uDirect;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSurf;\nvarying vec3 vSurf;\nvarying vec2 vDecalUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = aSurf;\nvDecalUv = uv;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurf;\nvarying vec2 vDecalUv;\nuniform sampler2D uDecal;\nuniform float uDirect;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vSurf.x;\nvec4 decal = texture2D(uDecal, vDecalUv);\nfloat onFace = step(0.5, vSurf.z);\nfloat polished = 1.0 - (1.0 - decal.a) * onFace;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * vSurf.y * mix(0.5, 1.0, polished), 0.05, 1.0);')
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;',
        'mapN.xy *= normalScale * vSurf.z * polished;\nmapN.xy += (decal.xy * 2.0 - 1.0) * onFace;'))
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= vSurf.x;
reflectedLight.indirectSpecular *= mix(1.0, vSurf.x, 0.85);
reflectedLight.directSpecular *= mix(1.0, vSurf.x, 0.6) * uDirect;`);
  };
  return m;
}

/** Label paper; the plane's uv is remapped into this replica's atlas cell (aCell). */
export function labelMaterial(atlas: { tex: THREE.Texture; cols: number; rows: number }, paper: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xf0f0f0, roughness: 0.72, metalness: 0, map: atlas.tex, alphaTest: 0.5,
    normalMap: paper, normalScale: new THREE.Vector2(0.35, 0.35),
  });
  m.onBeforeCompile = (s) => {
    s.uniforms.uCols = { value: atlas.cols };
    s.uniforms.uRows = { value: atlas.rows };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aCell; uniform float uCols; uniform float uRows;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
{ float cell = floor(aCell + 0.5); float col = mod(cell, uCols); float row = floor(cell / uCols);
  vMapUv = vec2((col + uv.x) / uCols, 1.0 - (row + 1.0 - uv.y) / uRows); }`);
  };
  return m;
}

/** Brushed and turned metals: the env cards carry the look; the key light's direct highlight is damped so it streaks instead of flaring. */
function softMetal(m: THREE.MeshPhysicalMaterial, direct = 0.45) {
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.directSpecular *= ${direct.toFixed(2)};`);
  };
  return m;
}

export function createTextures(lite = false) {
  const k = lite ? 0.5 : 1; // lite: half resolution (the tile sizes in millimetres stay the same)
  const brushed = brushedTextures(512 * k, 256 * k);
  for (const t of [brushed.normal, brushed.roughness]) t.repeat.set(1 / 38, 1 / 9);
  const stipple = stippleTexture(512 * k);
  stipple.repeat.set((CASE.w * 2) / 16, CASE.h / 16); // decal uv spans both faces: one stipple tile per 16 mm (grains ≈ 0.1 mm)
  const hubAniso = circularAnisotropy();
  hubAniso.repeat.setScalar(1 / 26); hubAniso.offset.setScalar(0.5);
  const mediaAniso = hubAniso.clone();
  mediaAniso.repeat.setScalar(1 / 88);
  mediaAniso.needsUpdate = true;
  const hubRings = ringNormals(256, 70, 1209);
  hubRings.repeat.setScalar(1 / 26); hubRings.offset.setScalar(0.5);
  const mediaRings = ringNormals(512 * k, 140, 9113);
  mediaRings.repeat.setScalar(1 / 88); mediaRings.offset.setScalar(0.5);
  const liner = linerTexture(512 * k);
  const paper = paperNormals();
  const decal = faceDecal(1024 * k);
  paper.repeat.setScalar(3);
  return { brushed, stipple, decal, hubAniso, mediaAniso, hubRings, mediaRings, liner, paper };
}
export type FloppyTextures = ReturnType<typeof createTextures>;

export function createMaterials(t: FloppyTextures, glass: GlassUniforms, atlas: { tex: THREE.Texture; cols: number; rows: number }) {
  return {
    abs: absMaterial(t.stipple, t.decal),
    glass: Object.assign(glassMaterial(glass), { normalMap: t.decal, normalScale: new THREE.Vector2(0.6, 0.6) }),
    steel: softMetal(new THREE.MeshPhysicalMaterial({
      color: 0xc4c5c8, metalness: 1, roughness: 0.36, roughnessMap: t.brushed.roughness, normalMap: t.brushed.normal,
      normalScale: new THREE.Vector2(0.25, 0.25), anisotropy: 0.75, anisotropyRotation: 0, envMapIntensity: 0.38,
    })),
    hub: softMetal(new THREE.MeshPhysicalMaterial({
      color: 0xb0b0b0, metalness: 1, roughness: 0.42, normalMap: t.hubRings, normalScale: new THREE.Vector2(0.12, 0.12),
      anisotropy: 0.6, anisotropyMap: t.hubAniso, envMapIntensity: 0.4,
    }), 0.6),
    media: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setRGB(30 / 255, 24 / 255, 20 / 255, THREE.SRGBColorSpace), metalness: 0, roughness: 0.26,
      normalMap: t.mediaRings, normalScale: new THREE.Vector2(0.05, 0.05), anisotropy: 0.85, anisotropyMap: t.mediaAniso, side: THREE.DoubleSide,
    }),
    liner: new THREE.MeshStandardMaterial({ color: 0x808080, map: t.liner, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    slider: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.42, metalness: 0 }),
    label: labelMaterial(atlas, t.paper),
  };
}
export type FloppyMaterials = ReturnType<typeof createMaterials>;
