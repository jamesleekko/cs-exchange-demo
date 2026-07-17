import * as THREE from 'three'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

// Three r180 forces alpha to 1 in the stock blur shader. Blurring RGBA keeps
// bloom visible outside geometry without turning this overlay canvas opaque.
export class TransparentUnrealBloomPass extends UnrealBloomPass {
  constructor(...args) {
    super(...args)
    // The blur shader keeps straight RGB and alpha. Add the bloom RGB at full
    // strength; the stock AdditiveBlending mode multiplies it by alpha again.
    this.blendMaterial.blending = THREE.CustomBlending
    this.blendMaterial.blendSrc = THREE.OneFactor
    this.blendMaterial.blendDst = THREE.OneFactor
    this.blendMaterial.blendEquation = THREE.AddEquation
    this.blendMaterial.blendSrcAlpha = THREE.OneFactor
    this.blendMaterial.blendDstAlpha = THREE.OneFactor
    this.blendMaterial.blendEquationAlpha = THREE.AddEquation
  }

  _getSeparableBlurMaterial(kernelRadius) {
    const coefficients = []
    for (let index = 0; index < kernelRadius; index++) {
      coefficients.push(
        0.39894
        * Math.exp(-0.5 * index * index / (kernelRadius * kernelRadius))
        / kernelRadius,
      )
    }

    return new THREE.ShaderMaterial({
      defines: {
        KERNEL_RADIUS: kernelRadius,
      },
      uniforms: {
        colorTexture: { value: null },
        invSize: { value: new THREE.Vector2(0.5, 0.5) },
        direction: { value: new THREE.Vector2(0.5, 0.5) },
        gaussianCoefficients: { value: coefficients },
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        #include <common>

        varying vec2 vUv;
        uniform sampler2D colorTexture;
        uniform vec2 invSize;
        uniform vec2 direction;
        uniform float gaussianCoefficients[KERNEL_RADIUS];

        void main() {
          float weightSum = gaussianCoefficients[0];
          vec4 diffuseSum = texture2D(colorTexture, vUv) * weightSum;
          for (int index = 1; index < KERNEL_RADIUS; index++) {
            float offset = float(index);
            float weight = gaussianCoefficients[index];
            vec2 uvOffset = direction * invSize * offset;
            vec4 sampleA = texture2D(colorTexture, vUv + uvOffset);
            vec4 sampleB = texture2D(colorTexture, vUv - uvOffset);
            diffuseSum += (sampleA + sampleB) * weight;
            weightSum += 2.0 * weight;
          }
          gl_FragColor = diffuseSum / weightSum;
        }
      `,
    })
  }

  dispose() {
    this.materialHighPassFilter?.dispose()
    super.dispose()
  }
}
