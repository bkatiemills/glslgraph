import * as glsl_helpers from './glsl_helpers.js';

export class heatmap {
    constructor(divId, options = {}) {
        const target = document.getElementById(divId);
        if (!target) {
            throw new Error(`No element found with ID "${divId}"`);
        }

        // decide on DOM sizes and scales
        let target_size = target.getBoundingClientRect();
        let sidebar_width = 400
        /// 1st precedence: options.[width, height] sets the plot size; 
        /// 2nd precendence: a target div's pre-defined size should bound the plot + sidebar
        /// 3rd precedence: the plot should fill the window, minus the sidebar
        if(options.width){
            this.plot_width = options.width;
        } else if(target_size.width) {
            this.plot_width = target_size.width - sidebar_width;
        } else {
            this.plot_width = window.innerWidth - sidebar_width;
        }
        if(options.height){
            this.plot_height = options.height;
        } else if(target_size.height) {
            this.plot_height = target_size.height;
        } else {
            this.plot_height = window.innerHeight;
        }

        // inject wrappers into parent div
        target.style.display = 'flex';
        const plotWrapper = document.createElement('div');
        plotWrapper.style.width = `${this.plot_width}px`;
        plotWrapper.style.height = `${this.plot_height}px`;
        const sidebarWrapper = document.createElement('div');
        sidebarWrapper.style.width = `${sidebar_width}px`;
        sidebarWrapper.style.height = `${this.plot_height}px`;
        target.appendChild(plotWrapper);
        target.appendChild(sidebarWrapper);

        // set up canvas stack
        /// glsl target canvas 
        this.glslcanvas = document.createElement('canvas');
        this.glslcanvas.style.position = 'absolute';
        this.glslcanvas.style.zIndex = 0;
        this.glslcanvas.width = this.plot_width //options.width || 512+this.colorbarWidth;
        this.glslcanvas.height = this.plot_height //options.height || 512;
        plotWrapper.appendChild(this.glslcanvas);

        /// markup canvas - scales, titles
        this.markupcanvas = document.createElement('canvas');
        this.markupcanvas.style.position = 'absolute';
        this.markupcanvas.style.zIndex = 1;
        this.markupcanvas.width = this.plot_width;
        this.markupcanvas.height = this.plot_height;
        plotWrapper.appendChild(this.markupcanvas);

        /// polygon canvas
        this.polycanvas = document.createElement('canvas');
        this.polycanvas.style.position = 'absolute';
        this.polycanvas.style.zIndex = 2;
        this.polycanvas.width = this.plot_width;
        this.polycanvas.height = this.plot_height;
        plotWrapper.appendChild(this.polycanvas);

        /// annotation canvas - top layer for annotations as well as mouse interactions
        this.annotationcanvas = document.createElement('canvas');
        this.annotationcanvas.style.position = 'absolute';
        this.annotationcanvas.style.zIndex = 3;
        this.annotationcanvas.width = this.plot_width;
        this.annotationcanvas.height = this.plot_height;        
        plotWrapper.appendChild(this.annotationcanvas);

        // decide on in-canvas sizes and scales
        this.colorbarWidth = 70;
        this.tickFontSize = 16;
        this.axisTitleFontSize = 20;
        this.markupcanvas.getContext('2d').font = `${this.tickFontSize}px sans-serif`;
        let colorbarAnnotationEst = this.markupcanvas.getContext('2d').measureText('0.00e+00').width;
        this.leftgutter = Math.max(this.plot_width*0.05, this.axisTitleFontSize + 4*this.tickFontSize);
        this.topgutter = this.plot_height * 0.02;
        this.rightgutter = colorbarAnnotationEst + this.colorbarWidth;
        this.bottomgutter = Math.max(this.plot_height*0.05, this.axisTitleFontSize + 2*this.tickFontSize);

        // cursor reporting
        this.cursorreport = document.createElement('div');
        sidebarWrapper.appendChild(this.cursorreport);

        // lin/log control
        this.scaleControl = document.createElement('select');
        this.scaleControl.innerHTML = `
            <option value="linear">Linear</option>
            <option value="log">Logarithmic</option>
        `;
        this.scaleControl.value = options.scale || 'linear';
        this.scaleControl.addEventListener('change', () => {
            this.scale = this.scaleControl.value;
            this.draw(this.data);
        });
        this.scale = this.scaleControl.value;
        sidebarWrapper.appendChild(this.scaleControl);

        /// vertex control div
        this.vertexcontrol = document.createElement('div');
        sidebarWrapper.appendChild(this.vertexcontrol);

        // click-drag-release
        this.dragStart = null;
        this.dragStart_px = null;
        this.dragEnd = null;
        this.annotationcanvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.annotationcanvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.annotationcanvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.annotationcanvas.addEventListener('dblclick', (e) => this.onDblClick(e));
        this.annotationcanvas.addEventListener('click', (e) => this.onClick(e));
        this.dragInProgress = false;
        this.mouseDownTimer = [];
        this.mouseUpTimer = [];
        this.clickTimer = [];

        // annotation members
        this.polyVertices_px = [];
        this.onVertexListUpdated = options.polycallback || null;

        // colorscale lookup tables
        this.viridisLUT = this.createColorscaleLUT(this.viridis, 256);

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

        this.xAxisTitle = options.xAxisTitle || '';
        this.yAxisTitle = options.yAxisTitle || '';
    }
    
    draw(zvalues){
        this.polyVertices_px = [];
        this.vertexcontrol.innerHTML = '';
        this.data = zvalues;
        if(!this.dragStart || !this.dragEnd) {
            this.nXbins = zvalues[0].length;
            this.nYbins = zvalues.length;
            this.xStart = 0
            this.yStart = 0
        }

        this.setColorscaleLimits();
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
                let val = this.scale === 'linear' ? zvalues[row][col] : Math.log(zvalues[row][col]);
                let color = this.viridisLUT[Math.floor((val - this.zmin) / (this.zmax - this.zmin) * (this.viridisLUT.length - 1))];
                offsets[2*index] = x;
                offsets[2*index + 1] = y;
                colors[4*index] = color[0];
                colors[4*index + 1] = color[1];
                colors[4*index + 2] = color[2];
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
    
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
    
        const tickLength = 4;
        
        // X ticks
        const xlabelEvery = Math.floor(this.nXbins / 10);
        ctx.font = `${this.tickFontSize}px sans-serif`;
        for (let i = 0; i <= this.nXbins; i++) {
            const x = ox + i * xTickSpacing;
            ctx.beginPath();
            ctx.moveTo(x, oy);
            ctx.lineTo(x, oy + tickLength);
            ctx.stroke();
        
            if (i % xlabelEvery === 0) {
                ctx.fillText(i+this.xStart, x, oy + this.tickFontSize + 3);
            }
        }
    
        // Y ticks
        ctx.textAlign = 'right';
        const ylabelEvery = Math.floor(this.nYbins / 10);
        for (let i = 0; i <= this.nYbins; i++) {
            const y = oy - i * yTickSpacing;
            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(ox, yEnd);
            ctx.stroke();
        
            if (i % ylabelEvery === 0) {
                ctx.fillText(i+this.yStart, ox - 6, y + 3);
            }
        }

        // X title
        ctx.font = `${this.axisTitleFontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(this.xAxisTitle, ox + (xEnd - ox) / 2, oy + this.axisTitleFontSize + this.tickFontSize);

        // Y title
        ctx.save();
        ctx.translate(ox - this.axisTitleFontSize*2, (oy + yEnd) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(this.yAxisTitle, 0, -this.axisTitleFontSize);
        ctx.restore();

        // colorbar
        this.drawColorbar(this.markupcanvas, {
            x: this.glslcanvas.width - 0.8*this.rightgutter,
            y: this.topgutter,
            width: 20,
            height: this.glslcanvas.height - this.topgutter - this.bottomgutter
        }, this.viridis);
    }
    
    onMouseMove(e) {
        const rect = this.annotationcanvas.getBoundingClientRect();
        const x = Math.floor(e.clientX - rect.left);
        const y = Math.floor(e.clientY - rect.top);
        const [xBin, yBin] = this.pixel2bin(x, y);

        if (this.dragInProgress) {
            // dragging: selecting a zoom region
            this.clearcanvas(this.annotationcanvas)
            this.boxdraw(this.annotationcanvas, this.dragStart_px, [x, y]);
        } else {
            // not dragging: cursors
            this.clearcanvas(this.annotationcanvas)
            if(x<this.leftgutter || x > this.annotationcanvas.width-this.rightgutter || y < this.topgutter || y > this.annotationcanvas.height-this.bottomgutter) {
                return
            }
            this.drawCursor(this.annotationcanvas, x, y);
            let val = this.scale === 'linear' ? this.data[yBin][xBin] : Math.log(this.data[yBin][xBin]);
            this.cursorreport.innerHTML = `Cursor: (${xBin}, ${yBin}: ${val})`;
        }
    }

    drawCursor(canvas, x, y) {
        const ctx = canvas.getContext('2d');
        
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
    
        // Horizontal line
        ctx.beginPath();
        ctx.moveTo(this.leftgutter, y);
        ctx.lineTo(canvas.width-this.rightgutter, y);
        ctx.stroke();
    
        // Vertical line
        ctx.beginPath();
        ctx.moveTo(x, this.topgutter);
        ctx.lineTo(x, canvas.height-this.bottomgutter);
        ctx.stroke();
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
            }, 250)
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
                this.clearcanvas(this.polycanvas);
                this.clearcanvas(this.annotationcanvas);
                this.mouseUpTimer = [];
            }, 100)
        );
      }

    onDragComplete(start, end) {
        // set everything for zooming in
        let left = Math.min(start[0], end[0]);
        let right = Math.max(start[0], end[0]);
        let bottom = Math.min(start[1], end[1]);
        let top = Math.max(start[1], end[1]);
        this.dragStart = [left, bottom]; 
        this.dragEnd = [right, top];
        this.nXbins = this.dragEnd[0] - this.dragStart[0];
        this.nYbins = this.dragEnd[1] - this.dragStart[1];
        this.xStart = this.dragStart[0];
        this.yStart = this.dragStart[1];
        this.draw(this.data)
    }

    onClick(e){
        if(!this.dragInProgress){
            this.mouseDownTimer.map(clearTimeout);
            this.mouseUpTimer.map(clearTimeout);
            this.clickTimer.push(setTimeout(() => {
                    const rect = this.polycanvas.getBoundingClientRect();
                    const x = Math.floor(e.clientX - rect.left);
                    const y = Math.floor(e.clientY - rect.top);
                    this.polyVertices_px.push([x, y]);
                    this.manageVertexControl();
                    this.renderPoly(this.polycanvas);
                    this.clickTimer = [];
                }, 250)
            )
        }
    }

    onDblClick(e) {
        this.mouseDownTimer.map(clearTimeout);
        this.mouseUpTimer.map(clearTimeout);
        this.clickTimer.map(clearTimeout);
        this.zoomout()
    }
    
    zoomout(){
        this.dragStart = null;
        this.dragStart_px = null;
        this.dragEnd = null;
        this.polyVertices_px = [];
        this.clearcanvas(this.annotationcanvas);
        this.clearcanvas(this.polycanvas);
        this.clearcanvas(this.markupcanvas);
        this.draw(this.data);
    }

    pixel2binX(x){
        const xBin = Math.floor((x - this.leftgutter) / ((this.glslcanvas.width - this.leftgutter - this.rightgutter) / this.nXbins));
        return xBin + this.xStart;
    }

    pixel2binY(y){
        const yBin = Math.floor((this.glslcanvas.height - this.bottomgutter - y) / ((this.glslcanvas.height - this.topgutter - this.bottomgutter) / this.nYbins));
        return yBin + this.yStart;
    }

    pixel2bin(x, y) {
        return [this.pixel2binX(x), this.pixel2binY(y)];
    }

    bin2pixelX(xBin) {
        return this.leftgutter + (xBin-this.xStart + 0.5) * ((this.glslcanvas.width - this.leftgutter - this.rightgutter) / this.nXbins);
    }

    bin2pixelY(yBin) {
        return this.glslcanvas.height - this.bottomgutter - (yBin-this.yStart + 0.5) * ((this.glslcanvas.height - this.topgutter - this.bottomgutter) / this.nYbins);
    }

    bin2pixel(x,y){
        return [this.bin2pixelX(x), this.bin2pixelY(y)];
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

    renderPoly(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (this.polyVertices_px.length < 2) return;

        ctx.beginPath();
        ctx.moveTo(this.polyVertices_px[0][0], this.polyVertices_px[0][1]);
        for (let i = 1; i < this.polyVertices_px.length; i++) {
            ctx.lineTo(this.polyVertices_px[i][0], this.polyVertices_px[i][1]);
        }
        ctx.closePath();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    
    manageVertexControl() {
        this.vertexcontrol.innerHTML = '';
    
        const ul = document.createElement('ul');
    
        this.polyVertices_px.forEach((vertex, index) => {
            const li = document.createElement('li');
            li.style.marginBottom = '8px';
    
            const inputX = document.createElement('input');
            inputX.type = 'number';
            inputX.value = this.pixel2binX(vertex[0]);
            inputX.style.width = '70px';
            inputX.addEventListener('input', () => {
                this.polyVertices_px[index][0] = this.bin2pixelX(parseFloat(inputX.value));
                this.renderPoly(this.polycanvas);
            });
            
            const inputY = document.createElement('input');
            inputY.type = 'number';
            inputY.value = this.pixel2binY(vertex[1]);
            inputY.style.width = '70px';
            inputY.addEventListener('input', () => {
                this.polyVertices_px[index][1] = this.bin2pixelY(parseFloat(inputY.value));
                this.renderPoly(this.polycanvas);
            });
    
            // Delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '🗑️';
            deleteBtn.title = 'Delete vertex';
            deleteBtn.addEventListener('click', () => {
                this.polyVertices_px.splice(index, 1);
                this.manageVertexControl();
                this.renderPoly(this.polycanvas);
            });
    
            // Move up button
            const upBtn = document.createElement('button');
            upBtn.textContent = '⬆️';
            upBtn.title = 'Move up';
            upBtn.disabled = index === 0;
            upBtn.addEventListener('click', () => {
                [this.polyVertices_px[index - 1], this.polyVertices_px[index]] =
                    [this.polyVertices_px[index], this.polyVertices_px[index - 1]];
                this.manageVertexControl();
                this.renderPoly(this.polycanvas);
            });
    
            // Move down button
            const downBtn = document.createElement('button');
            downBtn.textContent = '⬇️';
            downBtn.title = 'Move down';
            downBtn.disabled = index === this.polyVertices_px.length - 1;
            downBtn.addEventListener('click', () => {
                [this.polyVertices_px[index], this.polyVertices_px[index + 1]] =
                    [this.polyVertices_px[index + 1], this.polyVertices_px[index]];
                this.manageVertexControl();
                this.renderPoly(this.polycanvas);
            });
    
            // Assemble the list item
            li.appendChild(document.createTextNode(`Vertex ${index + 1}: `));
            li.appendChild(inputX);
            li.appendChild(document.createTextNode(', '));
            li.appendChild(inputY);
            li.appendChild(deleteBtn);
            li.appendChild(upBtn);
            li.appendChild(downBtn);
    
            ul.appendChild(li);
        });
    
        this.vertexcontrol.appendChild(ul);

        if (typeof this.onVertexListUpdated === 'function') {
            const displayCoords = this.polyVertices_px.map(([px, py]) => [
                this.pixel2binX(px),
                this.pixel2binY(py)
            ]);
            this.onVertexListUpdated(displayCoords);
        }
    }

    viridis(t) {
        t = Math.max(0, Math.min(1, t));
    
        const a = [
            [0.267, 0.004, 0.329], [0.283, 0.141, 0.458], [0.254, 0.265, 0.530],
            [0.207, 0.372, 0.553], [0.164, 0.471, 0.558], [0.128, 0.567, 0.551],
            [0.135, 0.659, 0.518], [0.267, 0.749, 0.441], [0.478, 0.821, 0.318],
            [0.741, 0.873, 0.150], [0.993, 0.906, 0.144]
        ];
        
        if (t === 1) return a[a.length - 1];

        const i = Math.floor(t * (a.length - 1));
        const frac = t * (a.length - 1) - i;
    
        const r = a[i][0] + frac * (a[i + 1][0] - a[i][0]);
        const g = a[i][1] + frac * (a[i + 1][1] - a[i][1]);
        const b = a[i][2] + frac * (a[i + 1][2] - a[i][2]);
    
        return [r, g, b];
    }

    createColorscaleLUT(colorscale, size = 256) {
        const lut = [];
        for (let i = 0; i < size; i++) {
            const t = i / (size - 1);
            lut.push(colorscale(t));
        }
        return lut;
    }

    drawColorbar(canvas, bboxPx, colorFn) {
        const ctx = canvas.getContext('2d');
        const { x, y, width, height } = bboxPx;
    
        const steps = height;
        const stepHeight = 1;
    
        // Draw gradient
        for (let i = 0; i < steps; i++) {
            const t = 1 - i / (steps - 1); // top = t=1, bottom = t=0
            const [r, g, b] = colorFn(t);
            ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
            ctx.fillRect(x, y + i * stepHeight, width, stepHeight);
        }
    
        // Draw border
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
    
        // Draw tick marks and labels
        const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
        ctx.fillStyle = 'white';
        ctx.font = `${this.tickFontSize}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
    
        for (let t of ticks) {
            const ty = y + (1 - t) * height;
            ctx.beginPath();
            ctx.moveTo(x + width, ty);
            ctx.lineTo(x + width + 5, ty);
            ctx.stroke();
    
            ctx.fillText((this.zmin + t*(this.zmax-this.zmin)).toExponential(2), x + width + 8, ty);
        }
    }

    setColorscaleLimits() {
        // find current z min and max
        this.zmin = Infinity;
        this.zmax = -Infinity;
        for (let row=this.yStart; row < this.yStart + this.nYbins ; row++) {
            for (let col=this.xStart; col < this.xStart + this.nXbins; col++) {
                if(this.dragStart && this.dragEnd) {
                    const [startX, startY] = this.dragStart;
                    const [endX, endY] = this.dragEnd;
                    if (col < startX || col > endX || row < startY || row > endY) {
                        continue; // Skip this bin if it's outside the drag area
                    }
                }
                if(this.scale == 'linear'){
                    if (this.data[row][col] == null) continue;
                    if (this.data[row][col] < this.zmin) this.zmin = this.data[row][col];
                    if (this.data[row][col] > this.zmax) this.zmax = this.data[row][col];
                } else if(this.scale == 'log'){
                    if (this.data[row][col] <= 0){
                        // bounce back to linear
                        this.scale = 'linear';
                        this.scaleControl.value = 'linear';
                        this.draw(this.data);
                    }
                    if (this.data[row][col] == null) continue;
                    if (Math.log(this.data[row][col]) < this.zmin) this.zmin = Math.log(this.data[row][col]);
                    if (Math.log(this.data[row][col]) > this.zmax) this.zmax = Math.log(this.data[row][col]);
                }
            }
        }
    }

}