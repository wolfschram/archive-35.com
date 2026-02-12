/*
    ============================================================
    ARCHIVE-35 Gallery Flythrough — v3
    PLATFORM: YouTube / Facebook / LinkedIn / X
    FORMAT:   1920x1080
    DURATION: 30 seconds (28s move + 2s hold on final photo)

    PLACEHOLDERS: Green solids (RGB 0,255,0) for runtime compositing
    ============================================================
*/
(function() {
    var CONFIG = {
        compName: "A35_Widescreen_16x9",
        compWidth: 1920, compHeight: 1080,
        compDuration: 30, compFPS: 30,
        moveTime: 28,   // camera moves for this long
        holdTime: 2,    // then holds on final photo
        numPhotos: 14,
        corridorWidth: 1400, frameSpacing: 650,
        frameWidth: 520, frameHeight: 347, frameBorder: 35,
        camStartZ: 600, camEndZ: -8500, camFOV: 45,
        ambientIntensity: 38, spotIntensity: 150,
        spotConeAngle: 48, spotFeather: 75, spotDistance: 350,
        bgColor: [0.02, 0.02, 0.03],
        wallColor: [0.06, 0.06, 0.07],
        frameBorderColor: [0.12, 0.11, 0.10],
        greenScreen: [0.0, 1.0, 0.0],    // PURE GREEN for compositing
        floorColor: [0.04, 0.04, 0.05],
        watermarkText: "archive-35.com",
        galleryLabel: "THE RESTLESS EYE"
    };

    // Safe property access — prevents "null is not an object"
    function safeProp(obj, matchName) {
        try { var p = obj.property(matchName); return p; }
        catch(e) { return null; }
    }
    function safeSet(obj, matchName, val) {
        try {
            var p = obj.property(matchName);
            if (p != null && p != undefined) p.setValue(val);
        } catch(e) { /* property not available in this AE version */ }
    }
    function pad(n) { return n < 10 ? "0" + n : "" + n; }

    app.beginUndoGroup("A35 Gallery v3");
    try {
        var comp = app.project.items.addComp(
            CONFIG.compName, CONFIG.compWidth, CONFIG.compHeight,
            1, CONFIG.compDuration, CONFIG.compFPS
        );
        comp.bgColor = CONFIG.bgColor;
        var cx = CONFIG.compWidth / 2;
        var cy = CONFIG.compHeight / 2;

        // ========== CAMERA ==========
        var cam = comp.layers.addCamera("Gallery Camera", [cx, cy]);
        var halfFOV = (CONFIG.camFOV / 2) * Math.PI / 180;
        var zoomVal = (CONFIG.compWidth / 2) / Math.tan(halfFOV);

        var camOpts = cam.property("ADBE Camera Options Group");
        safeSet(camOpts, "ADBE Camera Zoom", zoomVal);
        safeSet(camOpts, "ADBE Camera Depth of Field", 1);
        safeSet(camOpts, "ADBE Camera Aperture", 80);
        safeSet(camOpts, "ADBE Camera Blur Level", 60);

        // Camera animation: move for moveTime, then HOLD
        var camPos = cam.property("ADBE Transform Group").property("ADBE Position");
        camPos.setValueAtTime(0, [cx, cy, CONFIG.camStartZ]);
        camPos.setValueAtTime(CONFIG.moveTime, [cx, cy, CONFIG.camEndZ]);
        // No keyframe at compDuration — camera stays at camEndZ

        // Ease: gentle start, steady cruise, gentle stop at final photo
        var ease1 = new KeyframeEase(0.5, 60);
        var ease2 = new KeyframeEase(0.5, 90);
        camPos.setTemporalEaseAtKey(1, [ease1]);
        camPos.setTemporalEaseAtKey(2, [ease2]);

        // Point of interest tracks ahead of camera, then locks
        var camPOI = cam.property("ADBE Transform Group").property("ADBE Anchor Point");
        camPOI.setValueAtTime(0, [cx, cy, CONFIG.camStartZ - 1200]);
        camPOI.setValueAtTime(CONFIG.moveTime, [cx, cy, CONFIG.camEndZ - 400]);

        // ========== AMBIENT LIGHT ==========
        var amb = comp.layers.addLight("Ambient", [cx, cy]);
        amb.lightType = LightType.AMBIENT;
        safeSet(amb.property("ADBE Light Options Group"), "ADBE Light Intensity", CONFIG.ambientIntensity);

        // ========== WALLS ==========
        var halfW = CONFIG.corridorWidth / 2;
        for (var ws = 0; ws < 2; ws++) {
            var wallX = (ws === 0) ? cx - halfW - 20 : cx + halfW + 20;
            var wall = comp.layers.addSolid(CONFIG.wallColor, "Wall_" + (ws === 0 ? "L" : "R"), 200, 8000, 1);
            wall.threeDLayer = true;
            wall.property("ADBE Transform Group").property("ADBE Position").setValue([wallX, cy, -3500]);
            wall.property("ADBE Transform Group").property("ADBE Orientation").setValue([0, (ws === 0 ? 90 : -90), 0]);
        }

        // ========== PHOTO FRAMES ==========
        var perSide = Math.ceil(CONFIG.numPhotos / 2);
        var idx = 1;
        for (var side = 0; side < 2; side++) {
            var wallPos = (side === 0) ? cx - halfW : cx + halfW;
            var yRot = (side === 0) ? -8 : 8;
            for (var i = 0; i < perSide; i++) {
                if (idx > CONFIG.numPhotos) break;
                var fz = -(i * CONFIG.frameSpacing);
                var lbl = pad(idx);

                // Dark bronze frame
                var frameBorder = comp.layers.addSolid(
                    CONFIG.frameBorderColor, "Frame_" + lbl,
                    CONFIG.frameWidth + CONFIG.frameBorder,
                    CONFIG.frameHeight + CONFIG.frameBorder, 1
                );
                frameBorder.threeDLayer = true;
                frameBorder.property("ADBE Transform Group").property("ADBE Position").setValue([wallPos, cy, fz]);
                frameBorder.property("ADBE Transform Group").property("ADBE Orientation").setValue([0, yRot, 0]);
                var bMat = safeProp(frameBorder, "ADBE Material Options Group");
                if (bMat) safeSet(bMat, "ADBE Ambient Coefficient", 60);

                // GREEN PLACEHOLDER (chroma-key target for runtime compositing)
                var photo = comp.layers.addSolid(
                    CONFIG.greenScreen, "[PHOTO_" + lbl + "]",
                    CONFIG.frameWidth, CONFIG.frameHeight, 1
                );
                photo.threeDLayer = true;
                var nudge = (side === 0) ? 3 : -3;
                photo.property("ADBE Transform Group").property("ADBE Position").setValue([wallPos + nudge, cy, fz]);
                photo.property("ADBE Transform Group").property("ADBE Orientation").setValue([0, yRot, 0]);
                var pMat = safeProp(photo, "ADBE Material Options Group");
                if (pMat) {
                    safeSet(pMat, "ADBE Ambient Coefficient", 80);
                    safeSet(pMat, "ADBE Diffuse Coefficient", 90);
                    safeSet(pMat, "ADBE Specular Coefficient", 20);
                }

                // Spotlight per photo
                var spot = comp.layers.addLight("Spot_" + lbl, [cx, cy]);
                spot.lightType = LightType.SPOT;
                var sOpts = spot.property("ADBE Light Options Group");
                safeSet(sOpts, "ADBE Light Intensity", CONFIG.spotIntensity);
                safeSet(sOpts, "ADBE Light Cone Angle", CONFIG.spotConeAngle);
                safeSet(sOpts, "ADBE Light Cone Feather2", CONFIG.spotFeather);
                safeSet(sOpts, "ADBE Light Color", [1.0, 0.95, 0.85]);
                safeSet(sOpts, "ADBE Light Casts Shadows", 1);
                safeSet(sOpts, "ADBE Light Shadow Darkness", 40);

                var lx = (side === 0) ? wallPos + CONFIG.spotDistance : wallPos - CONFIG.spotDistance;
                spot.property("ADBE Transform Group").property("ADBE Position").setValue([lx, cy - 300, fz]);
                spot.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([wallPos, cy, fz]);
                idx++;
            }
        }

        // ========== FLOOR ==========
        var floor = comp.layers.addSolid(CONFIG.floorColor, "Floor", 8000, CONFIG.corridorWidth * 3, 1);
        floor.threeDLayer = true;
        floor.property("ADBE Transform Group").property("ADBE Position").setValue([cx, cy + 250, -3500]);
        floor.property("ADBE Transform Group").property("ADBE Orientation").setValue([90, 0, 0]);
        floor.property("ADBE Transform Group").property("ADBE Opacity").setValue(50);
        var fMat = safeProp(floor, "ADBE Material Options Group");
        if (fMat) { safeSet(fMat, "ADBE Specular Coefficient", 60); safeSet(fMat, "ADBE Shininess Coefficient", 80); }

        // ========== CEILING ==========
        var ceil = comp.layers.addSolid([0.03, 0.03, 0.04], "Ceiling", 8000, CONFIG.corridorWidth * 3, 1);
        ceil.threeDLayer = true;
        ceil.property("ADBE Transform Group").property("ADBE Position").setValue([cx, cy - 350, -3500]);
        ceil.property("ADBE Transform Group").property("ADBE Orientation").setValue([90, 0, 0]);
        ceil.property("ADBE Transform Group").property("ADBE Opacity").setValue(28);

        // ========== BRANDING (2D overlays) ==========
        var urlText = comp.layers.addText(CONFIG.watermarkText);
        var urlTD = urlText.property("ADBE Text Properties").property("ADBE Text Document").value;
        urlTD.fontSize = 24;
        urlTD.fillColor = [0.55, 0.55, 0.55];
        urlText.property("ADBE Text Properties").property("ADBE Text Document").setValue(urlTD);
        urlText.property("ADBE Transform Group").property("ADBE Position").setValue([cx, CONFIG.compHeight - 40]);
        urlText.property("ADBE Transform Group").property("ADBE Opacity").setValue(65);
        urlText.moveToBeginning();

        var nameText = comp.layers.addText(CONFIG.galleryLabel);
        var nameTD = nameText.property("ADBE Text Properties").property("ADBE Text Document").value;
        nameTD.fontSize = 18;
        nameTD.fillColor = [0.45, 0.45, 0.45];
        nameTD.tracking = 400;
        nameText.property("ADBE Text Properties").property("ADBE Text Document").setValue(nameTD);
        nameText.property("ADBE Transform Group").property("ADBE Position").setValue([cx, 40]);
        nameText.property("ADBE Transform Group").property("ADBE Opacity").setValue(55);
        nameText.moveToBeginning();

        // ========== DONE ==========
        alert(
            "ARCHIVE-35 GALLERY v3\n" +
            "1920x1080 | YouTube / Facebook / LinkedIn / X\n\n" +
            CONFIG.numPhotos + " frames | " + CONFIG.moveTime + "s fly + " + CONFIG.holdTime + "s hold\n\n" +
            "Green placeholders ready for compositing.\n" +
            "Camera lands on final photo and holds 2s.\n\n" +
            "EXPORT: Render Queue > PNG Sequence (RGB+Alpha)"
        );
    } catch(e) {
        alert("Error: " + e.toString() + (e.line ? "\nLine: " + e.line : ""));
    }
    app.endUndoGroup();
})();
