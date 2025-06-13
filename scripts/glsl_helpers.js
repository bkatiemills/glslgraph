  // Vertex shader
  export const vsSource = `#version 300 es
  in vec2 a_vertex;
  in vec2 a_offset;
  in vec4 a_color;
  uniform vec2 u_cellSize;
  uniform vec2 u_resolution;
  out vec4 v_color;

  void main() {
    vec2 pixel = (a_vertex * u_cellSize + a_offset);
    vec2 clip = pixel / u_resolution * 2.0 - 1.0;
    gl_Position = vec4(clip * vec2(1, -1), 0, 1);
    v_color = a_color;
  }`;

  // Fragment shader
  export const fsSource = `#version 300 es
  precision mediump float;
  in vec4 v_color;
  out vec4 outColor;
  void main() {
    outColor = v_color;
  }`;

  export function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  export function createProgram(gl, vsSource, fsSource) {
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
  }