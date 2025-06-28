import * as glsl_helpers from './glsl_helpers.js';

export class heatmap {
    constructor(divId, options = {}) {
        const target = document.getElementById(divId);
        if (!target) {
            throw new Error(`No element found with ID "${divId}"`);
        }
    
        // glsl target canvas 
        this.glslcanvas = document.createElement('canvas');
        this.glslcanvas.style.position = 'absolute';
        this.glslcanvas.style.zIndex = 0;
        this.glslcanvas.width = options.width || 512;
        this.glslcanvas.height = options.height || 512;
        target.appendChild(this.glslcanvas);


        // markup canvas - top layer for annotations as well as mouse interactions
        this.markupcanvas = document.createElement('canvas');
        this.markupcanvas.style.position = 'absolute';
        this.markupcanvas.style.zIndex = 1;
        this.markupcanvas.width = this.glslcanvas.width;
        this.markupcanvas.height = this.glslcanvas.height;
        this.markupcanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        target.appendChild(this.markupcanvas);

        // annotation canvas - scales, titles
        this.annotationcanvas = document.createElement('canvas');
        this.annotationcanvas.style.position = 'absolute';
        this.annotationcanvas.style.zIndex = 2;
        this.annotationcanvas.width = this.glslcanvas.width;
        this.annotationcanvas.height = this.glslcanvas.height;
        this.annotationcanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        target.appendChild(this.annotationcanvas);
        this.annotationcanvas.addEventListener('dblclick', (e) => {
            this.mouseDownTimer.map(clearTimeout);
            this.mouseUpTimer.map(clearTimeout);
            this.zoomout(e)
        });

        // coord div
        this.mouseoverdiv = document.createElement('div');
        this.mouseoverdiv.style.color = 'black';
        this.mouseoverdiv.style.position = 'absolute';
        this.mouseoverdiv.style.top = '600px';
        target.appendChild(this.mouseoverdiv);

        // click-drag-release
        this.dragStart = null;
        this.dragStart_px = null;
        this.dragEnd = null;
        this.annotationcanvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.annotationcanvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.dragInProgress = false;
        this.mouseDownTimer = [];
        this.mouseUpTimer = [];

        // markup gutters
        this.leftgutter = this.glslcanvas.width * 0.1;
        this.topgutter = this.glslcanvas.height * 0.02;
        this.rightgutter = this.glslcanvas.width * 0.02;
        this.bottomgutter = this.glslcanvas.height * 0.1;
    
        // glsl guts
        this.gl = this.glslcanvas.getContext('webgl2');
        if (!this.gl) {
            throw new Error('WebGL2 is not supported by your browser');
        }
        this.program = glsl_helpers.createProgram(this.gl, glsl_helpers.vsSource, glsl_helpers.fsSource);
        this.gl.useProgram(this.program);

        this.quadVertices = new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5,  0.5, 0.5,  0.5,]);
        this.vertexBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.quadVertices, this.gl.STATIC_DRAW);

        const a_vertex = this.gl.getAttribLocation(this.program, 'a_vertex');
        this.gl.enableVertexAttribArray(a_vertex);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.vertexAttribPointer(a_vertex, 2, this.gl.FLOAT, false, 0, 0);

        this.init();
    }
    
    init() {

    }

    draw(zvalues){
        this.data = zvalues;
        this.nXbins = zvalues[0].length;
        this.nYbins = zvalues.length;
        this.xStart = 0
        this.yStart = 0
        if (this.dragStart && this.dragEnd) {
            this.nXbins = this.dragEnd[0] - this.dragStart[0];
            this.nYbins = this.dragEnd[1] - this.dragStart[1];
            this.xStart = this.dragStart[0];
            this.yStart = this.dragStart[1];
        }

        const cellSize = [(this.glslcanvas.width-this.leftgutter-this.rightgutter)/this.nXbins, (this.glslcanvas.height-this.bottomgutter-this.topgutter)/this.nYbins];
        const resolution = [this.glslcanvas.width, this.glslcanvas.height];
        const instances = this.nXbins * this.nYbins;
        const offsets = new Float32Array(instances * 2);
        const colors = new Float32Array(instances * 4);
    
        let index = 0
        for (let row=this.yStart; row < this.yStart + this.nYbins ; row++) {
            for (let col=this.xStart; col < this.xStart + this.nXbins; col++) {
                if(this.dragStart && this.dragEnd) {
                    const [startX, startY] = this.dragStart;
                    const [endX, endY] = this.dragEnd;
                    if (col < startX || col > endX || row < startY || row > endY) {
                        continue; // Skip this bin if it's outside the drag area
                    }
                }
                const x = this.leftgutter + (col-this.xStart+0.5) * cellSize[0];
                const y = this.topgutter + (this.nYbins - (row - this.yStart) - 0.5) * cellSize[1];
                const intensity = zvalues[row][col];
                offsets[2*index] = x;
                offsets[2*index + 1] = y;
                colors[4*index] = intensity;
                colors[4*index + 1] = intensity;
                colors[4*index + 2] = intensity;
                colors[4*index + 3] = 1.0;
                index++;    
            }
        }

        const gl = this.gl;
        // Per-instance attributes: a_offset and a_color
        const offsetBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW);
        const a_offset = gl.getAttribLocation(this.program, 'a_offset');
        gl.enableVertexAttribArray(a_offset);
        gl.vertexAttribPointer(a_offset, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(a_offset, 1);

        const colorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
        const a_color = gl.getAttribLocation(this.program, 'a_color');
        gl.enableVertexAttribArray(a_color);
        gl.vertexAttribPointer(a_color, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(a_color, 1);

        // Set uniforms
        gl.uniform2fv(gl.getUniformLocation(this.program, 'u_cellSize'), cellSize);
        gl.uniform2fv(gl.getUniformLocation(this.program, 'u_resolution'), resolution);

        // Draw
        gl.clearColor(0, 0.3, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances);  

        this.drawAxes();
    }

    drawAxes() {
        const ctx = this.markupcanvas.getContext('2d');
        ctx.clearRect(0, 0, this.markupcanvas.width, this.markupcanvas.height);
    
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
    
        const [ox, oy] = [this.leftgutter, this.markupcanvas.height - this.bottomgutter];
        const xEnd = ox + this.markupcanvas.width - this.rightgutter - this.leftgutter;
        const yEnd = oy - (this.markupcanvas.height - this.topgutter - this.bottomgutter);
    
        const xTickSpacing = (xEnd - ox) / this.nXbins;
        const yTickSpacing = (oy - yEnd) / this.nYbins;
    
        ctx.font = '10px sans-serif';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
    
        const tickLength = 4;
        const labelEvery = Math.floor(Math.min(this.nYbins,this.nXbins) / 10);
    
        // X ticks
        for (let i = 0; i <= this.nXbins; i++) {
        const x = ox + i * xTickSpacing;
        ctx.beginPath();
        ctx.moveTo(x, oy);
        ctx.lineTo(x, oy + tickLength);
        ctx.stroke();
    
        if (i % labelEvery === 0) {
            ctx.fillText(i+this.xStart, x, oy + 12);
        }
        }
    
        ctx.textAlign = 'right';
    
        // Y ticks
        for (let i = 0; i <= this.nYbins; i++) {
        const y = oy - i * yTickSpacing;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox, yEnd);
        ctx.stroke();
    
        if (i % labelEvery === 0) {
            ctx.fillText(i+this.yStart, ox - 6, y + 3);
        }
        }
    }
    
    handleMouseMove(e) {
        const rect = this.annotationcanvas.getBoundingClientRect();
        const x = Math.floor(e.clientX - rect.left);
        const y = Math.floor(e.clientY - rect.top);
        const [xBin, yBin] = this.pixel2bin(x, y);

        if (this.dragInProgress) {
            this.clearcanvas(this.annotationcanvas)
            this.boxdraw(this.annotationcanvas, this.dragStart_px, [x, y]);
        }

        this.mouseoverdiv.textContent = `Bin: (${xBin}, ${yBin})`;
    }

    onMouseDown(e) {
        this.mouseDownTimer.push(setTimeout(() => {
                const rect = this.annotationcanvas.getBoundingClientRect();
                const x = Math.floor(e.clientX - rect.left);
                const y = Math.floor(e.clientY - rect.top);
            
                this.dragStart = this.pixel2bin(x, y)
                this.dragStart_px = [x, y];
                this.dragInProgress = true;
                this.mouseDownTimer = [];
            }, 200)
        );
      }
      
    onMouseUp(e) {
        this.mouseUpTimer.push(setTimeout(() => {
                const rect = this.annotationcanvas.getBoundingClientRect();
                const x = Math.floor(e.clientX - rect.left);
                const y = Math.floor(e.clientY - rect.top);
            
                this.dragEnd = this.pixel2bin(x, y)
            
                if (this.dragStart) {
                    this.onDragComplete(this.dragStart, this.dragEnd);
                }
                this.dragInProgress = false;
                this.clearcanvas(this.annotationcanvas);
                this.mouseUpTimer = [];
            }, 200)
        );
      }

    onDragComplete(start, end) {
        // munge corners to be bottom left to top right
        let left = Math.min(start[0], end[0]);
        let right = Math.max(start[0], end[0]);
        let bottom = Math.min(start[1], end[1]);
        let top = Math.max(start[1], end[1]);
        this.dragStart = [left, bottom]; 
        this.dragEnd = [right, top];
        this.draw(this.data)
    }

    pixel2bin(x, y) {
        const xBin = Math.floor((x - this.leftgutter) / ((this.glslcanvas.width - this.leftgutter - this.rightgutter) / this.nXbins));
        const yBin = Math.floor((this.glslcanvas.height - this.bottomgutter - y) / ((this.glslcanvas.height - this.topgutter - this.bottomgutter) / this.nYbins));
        return [xBin, yBin];
    }

    boxdraw(canvas, coord0, coord1){
        const ctx = canvas.getContext('2d');

        // Coordinates of two opposite corners
        const x1 = coord0[0];
        const y1 = coord0[1];
        const x2 = coord1[0];
        const y2 = coord1[1];
        
        // Normalize coordinates to handle any corner pair
        const left   = Math.min(x1, x2);
        const top    = Math.min(y1, y2);
        const width  = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        
        // Set drawing style
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'white';
        
        // Draw rectangle outline
        ctx.strokeRect(left, top, width, height);
    }

    clearcanvas(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    zoomout(e){
        this.dragStart = null;
        this.dragStart_px = null;
        this.dragEnd = null;
        this.clearcanvas(this.annotationcanvas);
        this.clearcanvas(this.markupcanvas);
        this.draw(this.data);
    }
  }