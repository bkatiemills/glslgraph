import * as glsl_helpers from './glsl_helpers.js';

export class heatmap {
    constructor(canvasDivId, controlDivId, options = {}) {
        const target = document.getElementById(canvasDivId);
        if (!target) {
            throw new Error(`No element found with ID "${canvasDivId}"`);
        }

        const controlTarget = document.getElementById(controlDivId);
        if (!controlTarget) {
            throw new Error(`No element found with ID "${controlDivId}"`);
        }

        // some general options
        this.bkgColor = options.bkgColor || 'transparent';
        this.textColor = options.textColor || '#000000';
        this.annotationColor = options.annotationColor || '#FF0000';

        // decide on DOM sizes and scales
        let target_size = target.getBoundingClientRect();
        /// 1st precedence: options.<width, height> sets the plot size; 
        /// 2nd precendence: a target div's pre-defined size should bound the plot
        /// 3rd precedence: the plot should fill the window
        if(options.width){
            this.plot_width = options.width;
            target.style.width = `${this.plot_width}px`;
        } else if(target_size.width) {
            this.plot_width = target_size.width;
        } else {
            this.plot_width = window.innerWidth;
            target.style.width = `${this.plot_width}px`;
        }
        if(options.height){
            this.plot_height = options.height;
            target.style.height = `${this.plot_height}px`;
        } else if(target_size.height) {
            this.plot_height = target_size.height;
        } else {
            this.plot_height = window.innerHeight;
            target.style.height = `${this.plot_height}px`;
        }

        // set up canvas stack
        /// glsl target canvas 
        this.glslcanvas = document.createElement('canvas');
        this.glslcanvas.style.position = 'absolute';
        this.glslcanvas.style.zIndex = 0;
        this.glslcanvas.width = this.plot_width //options.width || 512+this.colorbarWidth;
        this.glslcanvas.height = this.plot_height //options.height || 512;
        target.appendChild(this.glslcanvas);

        /// markup canvas - scales, titles
        this.markupcanvas = document.createElement('canvas');
        this.markupcanvas.style.position = 'absolute';
        this.markupcanvas.style.zIndex = 1;
        this.markupcanvas.width = this.plot_width;
        this.markupcanvas.height = this.plot_height;
        target.appendChild(this.markupcanvas);

        /// polygon canvas
        this.polycanvas = document.createElement('canvas');
        this.polycanvas.style.position = 'absolute';
        this.polycanvas.style.zIndex = 2;
        this.polycanvas.width = this.plot_width;
        this.polycanvas.height = this.plot_height;
        target.appendChild(this.polycanvas);

        /// annotation canvas - top layer for annotations as well as mouse interactions
        this.annotationcanvas = document.createElement('canvas');
        this.annotationcanvas.style.position = 'absolute';
        this.annotationcanvas.style.zIndex = 3;
        this.annotationcanvas.width = this.plot_width;
        this.annotationcanvas.height = this.plot_height;        
        target.appendChild(this.annotationcanvas);

        // decide on in-canvas sizes and scales
        this.colorbarWidth = 70;
        this.tickFontSize = 16;
        this.axisTitleFontSize = 20;
        this.markupcanvas.getContext('2d').font = `${this.tickFontSize}px sans-serif`;
        let colorbarAnnotationEst = this.markupcanvas.getContext('2d').measureText('0.00e+00').width;
        this.leftgutter = Math.max(this.plot_width*0.05, this.axisTitleFontSize + 4*this.tickFontSize);
        this.topgutter = this.plot_height * 0.04;
        this.rightgutter = colorbarAnnotationEst + this.colorbarWidth;
        this.bottomgutter = Math.max(this.plot_height*0.05, this.axisTitleFontSize + 2*this.tickFontSize);

        // cursor reporting
        this.cursorreport = document.createElement('div');
        this.cursorreport.textContent = 'Cursor: -';
        controlTarget.appendChild(this.cursorreport);

        // lin/log control
        this.scaleControlLabel = document.createElement('label');
        this.scaleControlLabel.textContent = 'Scale: ';
        this.scaleControlLabel.style.marginRight = '10px';
        this.scaleControlLabel.style.display = 'block';
        controlTarget.appendChild(this.scaleControlLabel);
        this.scaleControl = document.createElement('select');
        this.scaleControl.innerHTML = `
            <option value="linear">Linear</option>
            <option value="log">Logarithmic</option>
        `;
        this.scaleControl.value = options.scale || 'linear';
        this.scaleControl.addEventListener('change', () => {
            this.scale = this.scaleControl.value;
            this.draw();
        });
        this.scale = this.scaleControl.value;
        controlTarget.appendChild(this.scaleControl);

        // color scale control
        this.colorscaleControlLabel = document.createElement('label');
        this.colorscaleControlLabel.textContent = 'Colorscale: ';
        this.colorscaleControlLabel.style.marginRight = '10px';
        this.colorscaleControlLabel.style.display = 'block';
        controlTarget.appendChild(this.colorscaleControlLabel);
        this.colorscaleControl = document.createElement('select');
        this.colorscaleControl.innerHTML = `
            <option value="viridis">Viridis</option>
            <option value="turbo">Turbo</option>
        `;
        this.colorscaleControl.value = options.colorscale || 'turbo';
        this.colorscaleControl.addEventListener('change', () => {
            this.manageColorscale();
            this.draw();
        });
        this.manageColorscale();
        controlTarget.appendChild(this.colorscaleControl);


        /// vertex control div
        this.vertexcontrol = document.createElement('div');
        controlTarget.appendChild(this.vertexcontrol);

        // click-drag-release
        this.dragStart = null;
        this.dragStart_px = null;
        this.dragEnd = null;
        this.annotationcanvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.annotationcanvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.annotationcanvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.annotationcanvas.addEventListener('mouseout', (e) => this.onMouseOut(e));
        this.annotationcanvas.addEventListener('dblclick', (e) => this.onDblClick(e));
        this.annotationcanvas.addEventListener('click', (e) => this.onClick(e));
        this.dragInProgress = false;
        this.mouseDownTimer = [];
        this.mouseUpTimer = [];
        this.clickTimer = [];

        // annotation members
        this.polyVertices_px = [];
        this.onVertexListUpdated = options.polycallback || null;

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

        this.data = null;
        this.instances = 0;
    }
    
    manageColorscale(){
        if (this.colorscaleControl.value === 'viridis') {
            this.colormapper = this.viridisColor;
            this.colorscaleLUT = this.createColorscaleLUT(this.viridisColor, 256);
        } else {
            this.colormapper = this.turboColor;
            this.colorscaleLUT = this.createColorscaleLUT(this.turboColor, 256);
        }
    }

    buildLookup(zvalues) {
        let sparseLookupTable = Array.from({ length: zvalues.yBins }, () => []);
        for (let k = 0; k < zvalues.x.length; k++) {
            sparseLookupTable[zvalues.y[k]][zvalues.x[k]] = zvalues.z[k];
        }

        return sparseLookupTable
    }

    setData(zvalues) {
        // manage ingesting new data.

        this.data = zvalues;
        if(zvalues.hasOwnProperty('xBins')){
            // sparse mode, encoded as:
            // {xBins: n, yBins: n, x: [x1, x2, ...], y: [y1, y2, ...], z: [z1, z2, ...]}

            /// build sparse lookup index
            this.sparseLookupTable = this.buildLookup(zvalues);

            this.nXbins = zvalues.xBins;
            this.nYbins = zvalues.yBins;
            this.currentXaxisMinValue = 0
            this.currentYaxisMinValue = 0
            this.currentXaxisMaxValue = zvalues.x.reduce((a, b) => Math.max(a, b), -Infinity);
            this.currentYaxisMaxValue = zvalues.y.reduce((a, b) => Math.max(a, b), -Infinity);
            this.xglobalEnd = this.currentXaxisMaxValue;
            this.yglobalEnd = this.currentYaxisMaxValue;

            this.instances = zvalues.x.length;
        } else {
            // dense mode, zvalues[i][j] is the z height of the i,jth bin.
            this.sparseLookupTable = null;

            this.nXbins = zvalues[0].length;
            this.nYbins = zvalues.length;
            this.currentXaxisMinValue = 0
            this.currentYaxisMinValue = 0
            this.currentXaxisMaxValue = this.nXbins - 1;
            this.currentYaxisMaxValue = this.nYbins - 1;
            this.xglobalEnd = this.currentXaxisMaxValue;
            this.yglobalEnd = this.currentYaxisMaxValue;
            this.instances = this.nXbins * this.nYbins;
        } 
    }

    draw(zvalues){
        
        // rerender the histogram
        // if zvalues is null, just use the pre-existing data.

        if(zvalues){
            this.setData(zvalues);
        }

        this.setColorscaleLimits();
        const cellSize = [(this.glslcanvas.width-this.leftgutter-this.rightgutter)/this.nXbins, (this.glslcanvas.height-this.bottomgutter-this.topgutter)/this.nYbins];
        const resolution = [this.glslcanvas.width, this.glslcanvas.height];
        let offsets = new Float32Array(this.instances * 2);
        let colors = new Float32Array(this.instances * 4);

        let index = 0

        if(this.sparseLookupTable){
            for(let i=0; i<this.data.x.length; i++){
                if(this.dragStart && this.dragEnd) {
                    const [startX, startY] = this.dragStart;
                    const [endX, endY] = this.dragEnd;
                    if (this.data.x[i] < startX || this.data.x[i] > endX || this.data.y[i] < startY || this.data.y[i] > endY) {
                        continue; // Skip this bin if it's outside the drag area
                    }
                }
                const x = this.leftgutter + (this.data.x[i]-this.currentXaxisMinValue+0.5) * cellSize[0];
                const y = this.topgutter + (this.nYbins - (this.data.y[i] - this.currentYaxisMinValue) - 0.5) * cellSize[1];
                let val = this.scale === 'linear' ? this.data.z[i] : Math.log(this.data.z[i]);
                if(val === -Infinity) continue
                let color = this.colorscaleLUT[Math.floor((val - this.zmin) / (this.zmax - this.zmin) * (this.colorscaleLUT.length - 1))];
                offsets[2*index] = x;
                offsets[2*index + 1] = y;
                colors[4*index] = color[0];
                colors[4*index + 1] = color[1];
                colors[4*index + 2] = color[2];
                colors[4*index + 3] = 1.0;
                index++;
            }
        } else {
            for (let row=this.currentYaxisMinValue; row < this.currentYaxisMinValue + this.nYbins ; row++) {
                for (let col=this.currentXaxisMinValue; col < this.currentXaxisMinValue + this.nXbins; col++) {
                    if(this.dragStart && this.dragEnd) {
                        const [startX, startY] = this.dragStart;
                        const [endX, endY] = this.dragEnd;
                        if (col < startX || col > endX || row < startY || row > endY) {
                            continue; // Skip this bin if it's outside the drag area
                        }
                    }
                    const x = this.leftgutter + (col-this.currentXaxisMinValue+0.5) * cellSize[0];
                    const y = this.topgutter + (this.nYbins - (row - this.currentYaxisMinValue) - 0.5) * cellSize[1];
                    let val = this.scale === 'linear' ? this.data[row][col] : Math.log(this.data[row][col]);
                    if(val === -Infinity) continue
                    let color = this.colorscaleLUT[Math.floor((val - this.zmin) / (this.zmax - this.zmin) * (this.colorscaleLUT.length - 1))];
                    offsets[2*index] = x;
                    offsets[2*index + 1] = y;
                    colors[4*index] = color[0];
                    colors[4*index + 1] = color[1];
                    colors[4*index + 2] = color[2];
                    colors[4*index + 3] = 1.0;
                    index++;    
                }
            }
        }
        offsets = offsets.subarray(0, index * 2);
        colors = colors.subarray(0, index * 4);

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
        if(this.bkgColor === 'transparent') {
            gl.clearColor(0, 0, 0, 0);
        } else {
            gl.clearColor(...this.glslcolor(this.bkgColor), 1);
        }
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, index);  

        this.drawAxes();
    }

    glslcolor(hexcolor){
        // take a hex colorstring like '#123456' and return it as an RGB array on [0,1]

        let h = hexcolor.replace('#', '');
        h = parseInt(h, 16);

        const r = ((h >> 16) & 0xFF) / 255;
        const g = ((h >> 8) & 0xFF) / 255;
        const b = (h & 0xFF) / 255;

        return [r, g, b];
    }

    drawAxes() {
        const ctx = this.markupcanvas.getContext('2d');
        ctx.clearRect(0, 0, this.markupcanvas.width, this.markupcanvas.height);
    
        ctx.strokeStyle = this.textColor;
        ctx.lineWidth = 2;
    
        const [ox, oy] = [this.leftgutter, this.markupcanvas.height - this.bottomgutter];
        const xEnd = ox + this.markupcanvas.width - this.rightgutter - this.leftgutter;
        const yEnd = oy - (this.markupcanvas.height - this.topgutter - this.bottomgutter);
    
        const xTickSpacing = (xEnd - ox) / this.nXbins;
        const yTickSpacing = (oy - yEnd) / this.nYbins;
    
        ctx.fillStyle = this.textColor;
        ctx.textAlign = 'center';
    
        const tickLength = 4;
        
        // X ticks
        const xlabelEvery = Math.floor(this.nXbins / Math.min(10, this.nXbins));
        ctx.font = `${this.tickFontSize}px sans-serif`;
        for (let i = 0; i <= this.nXbins; i++) {
            const x = ox + i * xTickSpacing;
            ctx.beginPath();
            ctx.moveTo(x, oy);
            ctx.lineTo(x, oy + tickLength);
            ctx.stroke();
        
            if (i % xlabelEvery === 0) {
                ctx.fillText(i+this.currentXaxisMinValue, x, oy + this.tickFontSize + 3);
            }
        }
    
        // Y ticks
        ctx.textAlign = 'right';
        const ylabelEvery = Math.floor(this.nYbins / Math.min(10, this.nYbins));
        for (let i = 0; i <= this.nYbins; i++) {
            const y = oy - i * yTickSpacing;
            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(ox, yEnd);
            ctx.stroke();
        
            if (i % ylabelEvery === 0) {
                ctx.fillText(i+this.currentYaxisMinValue, ox - 6, y + 3);
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
        }, this.colormapper);
    }
    
    onMouseMove(e) {
        if(this.data === null) {
            return
        }

        const rect = this.annotationcanvas.getBoundingClientRect();
        const x = Math.floor(e.clientX - rect.left);
        const y = Math.floor(e.clientY - rect.top);
        const [xBin, yBin] = this.pixel2bin(x, y);

        let val = null
        if(xBin < this.currentXaxisMinValue || xBin >= this.currentXaxisMaxValue ||
           yBin < this.currentYaxisMinValue || yBin >= this.currentYaxisMaxValue) {
            this.cursorreport.innerHTML = `Cursor: -`;
        } else{
            if(this.sparseLookupTable){
                val = this.scale === 'linear' ? this.sparseLookupTable[yBin][xBin] : Math.log(this.sparseLookupTable[yBin][xBin]);
            } else {
                val = this.scale === 'linear' ? this.data[yBin][xBin] : Math.log(this.data[yBin][xBin]);
            }
            if(val === undefined){
                val = 0
            }
        }

        if (this.dragInProgress) {
            // dragging: selecting a zoom region
            this.clearcanvas(this.annotationcanvas)
            this.boxdraw(this.annotationcanvas, this.dragStart_px, [x, y]);
            this.cursorreport.innerHTML = `Cursor: (${xBin}, ${yBin}: ${val})`;
        } else {
            // not dragging: cursors
            this.clearcanvas(this.annotationcanvas)
            if(x<this.leftgutter || x > this.annotationcanvas.width-this.rightgutter || y < this.topgutter || y > this.annotationcanvas.height-this.bottomgutter) {
                return
            }
            this.drawCursor(this.annotationcanvas, x, y);

            this.cursorreport.innerHTML = `Cursor: (${xBin}, ${yBin}: ${val})`;
        }
    }

    drawCursor(canvas, x, y) {
        const ctx = canvas.getContext('2d');
        
        ctx.strokeStyle = this.annotationColor;
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
        if(this.data === null) {
            return
        }

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
        if(this.data === null) {
            return
        }

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

    onMouseOut(e){
        if(this.data === null) {
            return
        }

        this.cursorreport.innerHTML = 'Cursor: -';
        if(!this.dragInProgress){
            return
        }
        this.dragInProgress = false;
        this.onMouseUp(e);
    }    

    onDragComplete(start, end) {
        // set everything for zooming in
        let left = Math.min(start[0], end[0]);
        let right = Math.max(start[0], end[0]);
        let bottom = Math.min(start[1], end[1]);
        let top = Math.max(start[1], end[1]);
        this.zoomX(left, right);
        this.zoomY(bottom, top);
        
        this.draw()
    }

    zoomX(start, end) {
        // zoom in on the x-axis
        this.polyVertices_px = [];
        this.vertexcontrol.innerHTML = '';

        this.dragStart = [start, this.currentYaxisMinValue];
        this.dragEnd = [end, this.currentYaxisMaxValue];
        this.nXbins = end - start;
        this.currentXaxisMinValue = start;
        this.currentXaxisMaxValue = end;
        //this.draw();
    }

    zoomY(start, end) {
        // zoom in on the y-axis
        this.polyVertices_px = [];
        this.vertexcontrol.innerHTML = '';

        this.dragStart = [this.currentXaxisMinValue, start];
        this.dragEnd = [this.currentXaxisMaxValue, end];
        this.nYbins = end - start;
        this.currentYaxisMinValue = start;
        this.currentYaxisMaxValue = end;
        //this.draw();
    }

    onClick(e){
        if(this.data === null) {
            return
        }

        if(!this.dragInProgress){
            this.mouseDownTimer.map(clearTimeout);
            this.mouseUpTimer.map(clearTimeout);
            this.clickTimer.push(setTimeout(() => {
                    const rect = this.polycanvas.getBoundingClientRect();
                    const x = Math.floor(e.clientX - rect.left);
                    const y = Math.floor(e.clientY - rect.top);
                    this.addPolyVertex(this.pixel2binX(x), this.pixel2binY(y));
                    this.clickTimer = [];
                }, 250)
            )
        }
    }

    addPolyVertex(x, y) {
        // add a vertex to the polygon at bin x, y
        this.polyVertices_px.push(this.bin2pixel(x, y));
        this.manageVertexControl();
        this.renderPoly(this.polycanvas);
    }

    onDblClick(e) {
        if(this.data === null) {
            return
        }

        this.mouseDownTimer.map(clearTimeout);
        this.mouseUpTimer.map(clearTimeout);
        this.clickTimer.map(clearTimeout);
        this.zoomout()
        this.draw()
    }
    
    zoomout(){
        this.polyVertices_px = [];
        this.vertexcontrol.innerHTML = '';
        this.dragStart = null;
        this.dragStart_px = null;
        this.dragEnd = null;
        this.polyVertices_px = [];
        if(this.data.hasOwnProperty('xBins')){
            this.nXbins = this.data.xBins;
            this.nYbins = this.data.yBins;
        } else {
            this.nXbins = this.data[0].length;
            this.nYbins = this.data.length;
        } 
        this.currentXaxisMinValue = 0
        this.currentYaxisMinValue = 0
        this.currentXaxisMaxValue = this.xglobalEnd;
        this.currentYaxisMaxValue = this.yglobalEnd;
        this.clearcanvas(this.annotationcanvas);
        this.clearcanvas(this.polycanvas);
        this.clearcanvas(this.markupcanvas);
    }

    pixel2binX(x){
        const xBin = Math.floor((x - this.leftgutter) / ((this.glslcanvas.width - this.leftgutter - this.rightgutter) / this.nXbins));
        return xBin + this.currentXaxisMinValue;
    }

    pixel2binY(y){
        const yBin = Math.floor((this.glslcanvas.height - this.bottomgutter - y) / ((this.glslcanvas.height - this.topgutter - this.bottomgutter) / this.nYbins));
        return yBin + this.currentYaxisMinValue;
    }

    pixel2bin(x, y) {
        return [this.pixel2binX(x), this.pixel2binY(y)];
    }

    bin2pixelX(xBin) {
        return this.leftgutter + (xBin-this.currentXaxisMinValue + 0.5) * ((this.glslcanvas.width - this.leftgutter - this.rightgutter) / this.nXbins);
    }

    bin2pixelY(yBin) {
        return this.glslcanvas.height - this.bottomgutter - (yBin-this.currentYaxisMinValue + 0.5) * ((this.glslcanvas.height - this.topgutter - this.bottomgutter) / this.nYbins);
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
        ctx.strokeStyle = this.annotationColor;
        
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
        ctx.strokeStyle = this.annotationColor;
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

    viridisColor(t) {
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

    turboColor(t) {
        t = Math.max(0, Math.min(1, t));

        // thanks to Anton Mikhailov, https://gist.github.com/mikhailov-work/6a308c20e494d9e0ccc29036b28faa7a
        const a = [[0.18995, 0.07176, 0.23217], [0.19483, 0.08339, 0.26149], [0.19956, 0.09498, 0.29024], [0.20415, 0.10652, 0.31844], [0.20860, 0.11802, 0.34607], [0.21291, 0.12947, 0.37314], [0.21708, 0.14087, 0.39964], [0.22111, 0.15223, 0.42558], [0.22500, 0.16354, 0.45096], [0.22875, 0.17481, 0.47578], [0.23236, 0.18603, 0.50004], [0.23582, 0.19720, 0.52373], [0.23915, 0.20833, 0.54686], [0.24234, 0.21941, 0.56942], [0.24539, 0.23044, 0.59142], [0.24830, 0.24143, 0.61286], [0.25107, 0.25237, 0.63374], [0.25369, 0.26327, 0.65406], [0.25618, 0.27412, 0.67381], [0.25853, 0.28492, 0.69300], [0.26074, 0.29568, 0.71162], [0.26280, 0.30639, 0.72968], [0.26473, 0.31706, 0.74718], [0.26652, 0.32768, 0.76412], [0.26816, 0.33825, 0.78050], [0.26967, 0.34878, 0.79631], [0.27103, 0.35926, 0.81156], [0.27226, 0.36970, 0.82624], [0.27334, 0.38008, 0.84037], [0.27429, 0.39043, 0.85393], [0.27509, 0.40072, 0.86692], [0.27576, 0.41097, 0.87936], [0.27628, 0.42118, 0.89123], [0.27667, 0.43134, 0.90254], [0.27691, 0.44145, 0.91328], [0.27701, 0.45152, 0.92347], [0.27698, 0.46153, 0.93309], [0.27680, 0.47151, 0.94214], [0.27648, 0.48144, 0.95064], [0.27603, 0.49132, 0.95857], [0.27543, 0.50115, 0.96594], [0.27469, 0.51094, 0.97275], [0.27381, 0.52069, 0.97899], [0.27273, 0.53040, 0.98461], [0.27106, 0.54015, 0.98930], [0.26878, 0.54995, 0.99303], [0.26592, 0.55979, 0.99583], [0.26252, 0.56967, 0.99773], [0.25862, 0.57958, 0.99876], [0.25425, 0.58950, 0.99896], [0.24946, 0.59943, 0.99835], [0.24427, 0.60937, 0.99697], [0.23874, 0.61931, 0.99485], [0.23288, 0.62923, 0.99202], [0.22676, 0.63913, 0.98851], [0.22039, 0.64901, 0.98436], [0.21382, 0.65886, 0.97959], [0.20708, 0.66866, 0.97423], [0.20021, 0.67842, 0.96833], [0.19326, 0.68812, 0.96190], [0.18625, 0.69775, 0.95498], [0.17923, 0.70732, 0.94761], [0.17223, 0.71680, 0.93981], [0.16529, 0.72620, 0.93161], [0.15844, 0.73551, 0.92305], [0.15173, 0.74472, 0.91416], [0.14519, 0.75381, 0.90496], [0.13886, 0.76279, 0.89550], [0.13278, 0.77165, 0.88580], [0.12698, 0.78037, 0.87590], [0.12151, 0.78896, 0.86581], [0.11639, 0.79740, 0.85559], [0.11167, 0.80569, 0.84525], [0.10738, 0.81381, 0.83484], [0.10357, 0.82177, 0.82437], [0.10026, 0.82955, 0.81389], [0.09750, 0.83714, 0.80342], [0.09532, 0.84455, 0.79299], [0.09377, 0.85175, 0.78264], [0.09287, 0.85875, 0.77240], [0.09267, 0.86554, 0.76230], [0.09320, 0.87211, 0.75237], [0.09451, 0.87844, 0.74265], [0.09662, 0.88454, 0.73316], [0.09958, 0.89040, 0.72393], [0.10342, 0.89600, 0.71500], [0.10815, 0.90142, 0.70599], [0.11374, 0.90673, 0.69651], [0.12014, 0.91193, 0.68660], [0.12733, 0.91701, 0.67627], [0.13526, 0.92197, 0.66556], [0.14391, 0.92680, 0.65448], [0.15323, 0.93151, 0.64308], [0.16319, 0.93609, 0.63137], [0.17377, 0.94053, 0.61938], [0.18491, 0.94484, 0.60713], [0.19659, 0.94901, 0.59466], [0.20877, 0.95304, 0.58199], [0.22142, 0.95692, 0.56914], [0.23449, 0.96065, 0.55614], [0.24797, 0.96423, 0.54303], [0.26180, 0.96765, 0.52981], [0.27597, 0.97092, 0.51653], [0.29042, 0.97403, 0.50321], [0.30513, 0.97697, 0.48987], [0.32006, 0.97974, 0.47654], [0.33517, 0.98234, 0.46325], [0.35043, 0.98477, 0.45002], [0.36581, 0.98702, 0.43688], [0.38127, 0.98909, 0.42386], [0.39678, 0.99098, 0.41098], [0.41229, 0.99268, 0.39826], [0.42778, 0.99419, 0.38575], [0.44321, 0.99551, 0.37345], [0.45854, 0.99663, 0.36140], [0.47375, 0.99755, 0.34963], [0.48879, 0.99828, 0.33816], [0.50362, 0.99879, 0.32701], [0.51822, 0.99910, 0.31622], [0.53255, 0.99919, 0.30581], [0.54658, 0.99907, 0.29581], [0.56026, 0.99873, 0.28623], [0.57357, 0.99817, 0.27712], [0.58646, 0.99739, 0.26849], [0.59891, 0.99638, 0.26038], [0.61088, 0.99514, 0.25280], [0.62233, 0.99366, 0.24579], [0.63323, 0.99195, 0.23937], [0.64362, 0.98999, 0.23356], [0.65394, 0.98775, 0.22835], [0.66428, 0.98524, 0.22370], [0.67462, 0.98246, 0.21960], [0.68494, 0.97941, 0.21602], [0.69525, 0.97610, 0.21294], [0.70553, 0.97255, 0.21032], [0.71577, 0.96875, 0.20815], [0.72596, 0.96470, 0.20640], [0.73610, 0.96043, 0.20504], [0.74617, 0.95593, 0.20406], [0.75617, 0.95121, 0.20343], [0.76608, 0.94627, 0.20311], [0.77591, 0.94113, 0.20310], [0.78563, 0.93579, 0.20336], [0.79524, 0.93025, 0.20386], [0.80473, 0.92452, 0.20459], [0.81410, 0.91861, 0.20552], [0.82333, 0.91253, 0.20663], [0.83241, 0.90627, 0.20788], [0.84133, 0.89986, 0.20926], [0.85010, 0.89328, 0.21074], [0.85868, 0.88655, 0.21230], [0.86709, 0.87968, 0.21391], [0.87530, 0.87267, 0.21555], [0.88331, 0.86553, 0.21719], [0.89112, 0.85826, 0.21880], [0.89870, 0.85087, 0.22038], [0.90605, 0.84337, 0.22188], [0.91317, 0.83576, 0.22328], [0.92004, 0.82806, 0.22456], [0.92666, 0.82025, 0.22570], [0.93301, 0.81236, 0.22667], [0.93909, 0.80439, 0.22744], [0.94489, 0.79634, 0.22800], [0.95039, 0.78823, 0.22831], [0.95560, 0.78005, 0.22836], [0.96049, 0.77181, 0.22811], [0.96507, 0.76352, 0.22754], [0.96931, 0.75519, 0.22663], [0.97323, 0.74682, 0.22536], [0.97679, 0.73842, 0.22369], [0.98000, 0.73000, 0.22161], [0.98289, 0.72140, 0.21918], [0.98549, 0.71250, 0.21650], [0.98781, 0.70330, 0.21358], [0.98986, 0.69382, 0.21043], [0.99163, 0.68408, 0.20706], [0.99314, 0.67408, 0.20348], [0.99438, 0.66386, 0.19971], [0.99535, 0.65341, 0.19577], [0.99607, 0.64277, 0.19165], [0.99654, 0.63193, 0.18738], [0.99675, 0.62093, 0.18297], [0.99672, 0.60977, 0.17842], [0.99644, 0.59846, 0.17376], [0.99593, 0.58703, 0.16899], [0.99517, 0.57549, 0.16412], [0.99419, 0.56386, 0.15918], [0.99297, 0.55214, 0.15417], [0.99153, 0.54036, 0.14910], [0.98987, 0.52854, 0.14398], [0.98799, 0.51667, 0.13883], [0.98590, 0.50479, 0.13367], [0.98360, 0.49291, 0.12849], [0.98108, 0.48104, 0.12332], [0.97837, 0.46920, 0.11817], [0.97545, 0.45740, 0.11305], [0.97234, 0.44565, 0.10797], [0.96904, 0.43399, 0.10294], [0.96555, 0.42241, 0.09798], [0.96187, 0.41093, 0.09310], [0.95801, 0.39958, 0.08831], [0.95398, 0.38836, 0.08362], [0.94977, 0.37729, 0.07905], [0.94538, 0.36638, 0.07461], [0.94084, 0.35566, 0.07031], [0.93612, 0.34513, 0.06616], [0.93125, 0.33482, 0.06218], [0.92623, 0.32473, 0.05837], [0.92105, 0.31489, 0.05475], [0.91572, 0.30530, 0.05134], [0.91024, 0.29599, 0.04814], [0.90463, 0.28696, 0.04516], [0.89888, 0.27824, 0.04243], [0.89298, 0.26981, 0.03993], [0.88691, 0.26152, 0.03753], [0.88066, 0.25334, 0.03521], [0.87422, 0.24526, 0.03297], [0.86760, 0.23730, 0.03082], [0.86079, 0.22945, 0.02875], [0.85380, 0.22170, 0.02677], [0.84662, 0.21407, 0.02487], [0.83926, 0.20654, 0.02305], [0.83172, 0.19912, 0.02131], [0.82399, 0.19182, 0.01966], [0.81608, 0.18462, 0.01809], [0.80799, 0.17753, 0.01660], [0.79971, 0.17055, 0.01520], [0.79125, 0.16368, 0.01387], [0.78260, 0.15693, 0.01264], [0.77377, 0.15028, 0.01148], [0.76476, 0.14374, 0.01041], [0.75556, 0.13731, 0.00942], [0.74617, 0.13098, 0.00851], [0.73661, 0.12477, 0.00769], [0.72686, 0.11867, 0.00695], [0.71692, 0.11268, 0.00629], [0.70680, 0.10680, 0.00571], [0.69650, 0.10102, 0.00522], [0.68602, 0.09536, 0.00481], [0.67535, 0.08980, 0.00449], [0.66449, 0.08436, 0.00424], [0.65345, 0.07902, 0.00408], [0.64223, 0.07380, 0.00401], [0.63082, 0.06868, 0.00401], [0.61923, 0.06367, 0.00410], [0.60746, 0.05878, 0.00427], [0.59550, 0.05399, 0.00453], [0.58336, 0.04931, 0.00486], [0.57103, 0.04474, 0.00529], [0.55852, 0.04028, 0.00579], [0.54583, 0.03593, 0.00638], [0.53295, 0.03169, 0.00705], [0.51989, 0.02756, 0.00780], [0.50664, 0.02354, 0.00863], [0.49321, 0.01963, 0.00955], [0.47960, 0.01583, 0.01055]]
    
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
        ctx.strokeStyle = this.textColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
    
        // Draw tick marks and labels
        const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
        ctx.fillStyle = this.textColor;
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
        if(this.sparseLookupTable){
            for (let i = 0; i < this.data.x.length; i++) {
                if(this.dragStart && this.dragEnd) {
                    const [startX, startY] = this.dragStart;
                    const [endX, endY] = this.dragEnd;
                    if (this.data.x[i] < startX || this.data.x[i] > endX || this.data.y[i] < startY || this.data.y[i] > endY) {
                        continue; // Skip this bin if it's outside the drag area
                    }
                }
                if (this.scale == 'linear') {
                    if (this.data.z[i] == null) continue;
                    if (this.data.z[i] < this.zmin) this.zmin = this.data.z[i];
                    if (this.data.z[i] > this.zmax) this.zmax = this.data.z[i];
                } else if (this.scale == 'log') {
                    if (this.data.z[i] < 0) {
                        // bounce back to linear
                        this.scale = 'linear';
                        this.scaleControl.value = 'linear';
                        this.draw();
                    }
                    if (this.data.z[i] === null || this.data.z[i] === 0) continue;
                    if (Math.log(this.data.z[i]) < this.zmin) this.zmin = Math.log(this.data.z[i]);
                    if (Math.log(this.data.z[i]) > this.zmax) this.zmax = Math.log(this.data.z[i]);
                }
            }
        } else {
            for (let row=this.currentYaxisMinValue; row < this.currentYaxisMinValue + this.nYbins ; row++) {
                for (let col=this.currentXaxisMinValue; col < this.currentXaxisMinValue + this.nXbins; col++) {
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
                        if (this.data[row][col] < 0){
                            // bounce back to linear
                            this.scale = 'linear';
                            this.scaleControl.value = 'linear';
                            this.draw();
                        }
                        if (this.data[row][col] === null || this.data[row][col] === 0) continue;
                        if (Math.log(this.data[row][col]) < this.zmin) this.zmin = Math.log(this.data[row][col]);
                        if (Math.log(this.data[row][col]) > this.zmax) this.zmax = Math.log(this.data[row][col]);
                    }
                }
            }
        }

        if(this.zmin === this.zmax){
            this.zmax = this.zmin + 1; // avoid division by zero
        }
    }

}