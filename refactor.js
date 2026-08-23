const fs = require('fs');

function replaceBlock(content, startMarker, endMarker, replacement) {
    const startIndex = content.indexOf(startMarker);
    if (startIndex === -1) throw new Error("Could not find start marker: " + startMarker);
    const endIndex = content.indexOf(endMarker, startIndex);
    if (endIndex === -1) throw new Error("Could not find end marker: " + endMarker);
    
    return content.substring(0, startIndex) + replacement + content.substring(endIndex + endMarker.length);
}

function replaceFunction(content, funcSignature, endStr, newFuncStr) {
    const startIndex = content.indexOf(funcSignature);
    if (startIndex === -1) throw new Error("Could not find function: " + funcSignature);
    const endIndex = content.indexOf(endStr, startIndex);
    if (endIndex === -1) throw new Error("Could not find end of function");
    
    return content.substring(0, startIndex) + newFuncStr + content.substring(endIndex + endStr.length);
}

try {
    let html = fs.readFileSync('index.html', 'utf8');

    // 1. Add isTestMode to CONFIG
    html = html.replace("const CONFIG = {", "const CONFIG = {\n      isTestMode: false,");

    // 2. Rewrite State management
    const newStateStr = `    const State = {
      players: [],
      historic: [],
      
      resetToDefaults() {
        this.players = JSON.parse(JSON.stringify(defaultPlayersData)).map(p => ({ name: p.name, isMe: p.isMe }));
        this.historic = JSON.parse(JSON.stringify(defaultHistoricData));
      },

      save() {
        try {
          const playersKey = CONFIG.isTestMode ? 'pauper_test_players' : 'pauper_players';
          const historicKey = CONFIG.isTestMode ? 'pauper_test_historic' : 'pauper_historic';
          localStorage.setItem(playersKey, JSON.stringify(this.players));
          localStorage.setItem(historicKey, JSON.stringify(this.historic));
          localStorage.setItem('pauper_data_version', CONFIG.DATA_VERSION);
          localStorage.setItem('lastUpdateTime', new Date().toISOString());
        } catch (e) {
          console.warn('No se pudo guardar en localStorage:', e);
        }
      },

      load() {
        try {
          const storedVersion = localStorage.getItem('pauper_data_version');
          if (storedVersion !== CONFIG.DATA_VERSION) {
            this.resetToDefaults();
            this.save();
            return;
          }
          const playersKey = CONFIG.isTestMode ? 'pauper_test_players' : 'pauper_players';
          const historicKey = CONFIG.isTestMode ? 'pauper_test_historic' : 'pauper_historic';
          const storedPlayers = localStorage.getItem(playersKey);
          const storedHistoric = localStorage.getItem(historicKey);
          
          if (storedPlayers) {
            this.players = JSON.parse(storedPlayers);
            this.players.forEach(p => {
              if (!p.isMe && p.name && Utils.isMyName(p.name)) {
                p.isMe = true;
              }
            });
          } else {
            this.players = JSON.parse(JSON.stringify(defaultPlayersData)).map(p => ({ name: p.name, isMe: p.isMe }));
          }
          if (storedHistoric) {
            this.historic = JSON.parse(storedHistoric);
          } else {
            this.historic = JSON.parse(JSON.stringify(defaultHistoricData));
          }
        } catch (e) {
          console.error('Error cargando datos de localStorage:', e);
          this.resetToDefaults();
        }
      },

      getCurrentSeasonEntries() {
        return this.historic.filter(item => item.season === CONFIG.CURRENT_SEASON);
      },

      resetCurrentSeason() {
        const confirmReset = confirm(\`⚠️ ¿Estás seguro de que deseas reiniciar la temporada \${CONFIG.CURRENT_SEASON} desde CERO?\\n\\nEsto vaciará los torneos de \${CONFIG.CURRENT_SEASON} para que puedas subirlos uno por uno desde tus capturas.\`);
        if (confirmReset) {
          this.historic = this.historic.filter(item => item.season !== CONFIG.CURRENT_SEASON);
          this.save();
          UI.refreshAll();
          alert(\`✨ ¡Temporada \${CONFIG.CURRENT_SEASON} reiniciada a cero! Ya puedes comenzar a subir tus capturas una a una.\`);
        }
      },

      deleteSeasonTournament(globalIdx) {
        const target = this.historic[globalIdx];
        if (!target) return;
        const confirmDel = confirm(\`¿Deseas eliminar la fecha "\${target.date} - \${target.deck}" del historial?\`);
        if (!confirmDel) return;
        this.historic.splice(globalIdx, 1);
        this.save();
        UI.refreshAll();
      },
      
      mergePlayers(badName) {
        const goodName = prompt(\`Fusionar jugador:\\n\\nVas a mover todos los puntos de "\${badName}" hacia otro jugador (y "\${badName}" será eliminado).\\n\\nEscribe el nombre EXACTO del jugador destino:\`);
        if (!goodName || goodName.trim() === "") return;
        
        const cleanGoodName = goodName.trim();
        const cleanBadName = badName.trim();
        
        // Remove bad player from registry
        this.players = this.players.filter(p => p.name.toLowerCase() !== cleanBadName.toLowerCase());
        
        // Ensure good player is in registry
        if (!this.players.find(p => p.name.toLowerCase() === cleanGoodName.toLowerCase())) {
           this.players.push({ name: cleanGoodName, isMe: Utils.isMyName(cleanGoodName) });
        }
        
        // Update historical points
        let mergedCount = 0;
        this.historic.forEach(entry => {
           if (entry.playerResults) {
               const badEntry = entry.playerResults.find(pr => pr.name.toLowerCase() === cleanBadName.toLowerCase());
               if (badEntry) {
                   const goodEntry = entry.playerResults.find(pr => pr.name.toLowerCase() === cleanGoodName.toLowerCase());
                   if (goodEntry) {
                       goodEntry.pts += badEntry.pts; // combine
                   } else {
                       badEntry.name = cleanGoodName; // just rename
                   }
                   // clean duplicates if we combined
                   entry.playerResults = entry.playerResults.filter(pr => pr.name.toLowerCase() !== cleanBadName.toLowerCase() || pr.name.toLowerCase() === cleanGoodName.toLowerCase());
                   mergedCount++;
               }
           }
        });
        
        this.save();
        UI.refreshAll();
        alert(\`✅ Fusión completada. Se actualizaron \${mergedCount} torneos históricos.\`);
      }
    };`;
    html = replaceBlock(html, '    const State = {', '    // ═══════════ SECTION: UTILS ═══════════', newStateStr + '\n\n    // ═══════════ SECTION: UTILS ═══════════');

    // 3. Rewrite Scanner.applyParsedText
    const newScannerFunc = `      applyParsedText({ isContinuation } = {}) {
        const manualInput = document.getElementById("scan-input");
        const fileInput = document.getElementById("screenshot-file");
        const rankInput = document.getElementById("scan-rank");
        const text = manualInput ? manualInput.value : "";
        
        if (!text.trim()) {
          UI.setStatus("⚠️ Sube una captura de pantalla o escribe el texto.", "#f85149");
          return;
        }

        try {
          const lines = text.split("\\n");
          let updatedCount = 0;
          let myPointsEarned = 0;
          let myWLD = "";
          let detectedMyRank = "";
          const updatedPlayersSet = new Set();
          const playerResults = []; // New array for storing this scan's points

          lines.forEach(line => {
            const parsed = this.parseLine(line);
            if (!parsed) return;
            
            let player = Utils.findMatchingPlayer(parsed.rawName, State.players);
            if (!player) {
              const isMe = Utils.isMyName(parsed.rawName);
              player = { name: parsed.rawName, isMe };
              State.players.push(player);
            }

            if (!updatedPlayersSet.has(player.name)) {
              playerResults.push({ name: player.name, pts: parsed.pts });
              updatedPlayersSet.add(player.name);
              updatedCount++;
              if (player.isMe) {
                myPointsEarned = parsed.pts;
                if (parsed.wld) myWLD = parsed.wld;
                if (parsed.rank) detectedMyRank = parsed.rank;
              }
            }
          });

          if (updatedCount > 0) {
            if (!isContinuation) {
              const formattedDate = this.getFormattedDate();
              const selectedDeck = this.getSelectedDeck();
              if (selectedDeck === "Otro Mazo") {
                 UI.setStatus("⚠️ Escribe el nombre del mazo personalizado antes de guardar.", "#f85149");
                 return; // Halt save if custom deck is blank
              }
              
              let finalRank = rankInput ? rankInput.value.trim() : "";
              if (!finalRank) {
                finalRank = detectedMyRank || \`\${State.players.findIndex(p => p.isMe) + 1}°\`;
              }
              if (!finalRank.endsWith("°") && !isNaN(parseInt(finalRank, 10))) {
                finalRank = \`\${parseInt(finalRank, 10)}°\`;
              }
              if (!myWLD) {
                myWLD = Utils.inferWLDFromPoints(myPointsEarned);
              }

              State.historic.push({
                date: formattedDate,
                season: CONFIG.CURRENT_SEASON,
                deck: selectedDeck,
                rank: finalRank,
                pts: myPointsEarned,
                wl: myWLD,
                type: myPointsEarned >= CONFIG.GOOD_THRESHOLD ? "good" : (myPointsEarned <= CONFIG.BAD_THRESHOLD ? "bad" : "normal"),
                playerResults: playerResults
              });
            } else {
              // Continuation logic (adding to last tournament)
              const entries = State.getCurrentSeasonEntries();
              if (entries.length > 0) {
                const lastEntry = entries[entries.length - 1];
                if (!lastEntry.playerResults) lastEntry.playerResults = [];
                
                playerResults.forEach(pr => {
                    const existing = lastEntry.playerResults.find(e => e.name === pr.name);
                    if (existing) existing.pts += pr.pts;
                    else lastEntry.playerResults.push(pr);
                });
                
                if (myPointsEarned > 0) {
                   lastEntry.pts = (lastEntry.pts || 0) + myPointsEarned;
                }
              }
            }

            State.save();
            UI.refreshAll();

            if (fileInput) fileInput.value = "";
            if (manualInput) manualInput.value = "";
            if (rankInput) rankInput.value = "";
            if (document.getElementById("same-day-continuation")) document.getElementById("same-day-continuation").checked = false;

            UI.setStatus(\`✅ Puntajes aplicados correctamente. \${myPointsEarned} puntos añadidos.\`, "#3fb950");
            setTimeout(() => {
              UI.setStatus("");
              UI.switchPage('g', document.querySelector('nav .nb'));
            }, 1500);

          } else {
            UI.setStatus("⚠️ No se detectaron puntajes válidos en el texto.", "#f85149");
          }
        } catch (err) {
          UI.setStatus(\`❌ Error en código: \${err.message}\`, "#f85149");
          console.error("Error crítico en applyParsedText:", err);
        }
      },`;
    html = replaceFunction(html, '      applyParsedText({ isContinuation } = {}) {', '        }\n      },', newScannerFunc);

    // 4. Update UI.renderLeaderboard to dynamically compute points and add merge button
    const newRenderLeaderboard = `      renderLeaderboard() {
        // Dynamically compute points from historic data
        const computedPlayers = State.players.map(p => ({ name: p.name, isMe: p.isMe, pts: 0 }));
        
        State.historic.forEach(entry => {
           if (entry.season === CONFIG.CURRENT_SEASON) {
               if (entry.playerResults) {
                   entry.playerResults.forEach(pr => {
                       let p = computedPlayers.find(cp => cp.name === pr.name);
                       if (!p) {
                           p = { name: pr.name, isMe: Utils.isMyName(pr.name), pts: 0 };
                           computedPlayers.push(p);
                       }
                       p.pts += (Number(pr.pts) || 0);
                   });
               } else {
                   // Legacy support: Only update 'me'
                   const me = computedPlayers.find(cp => cp.isMe);
                   if (me && entry.pts) me.pts += (Number(entry.pts) || 0);
               }
           }
        });
        
        computedPlayers.sort((a, b) => b.pts - a.pts);
        
        const container = document.getElementById("general-list");
        const stored = localStorage.getItem('lastUpdateTime');
        const lastUpdateText = stored ? \`<p class="note" style="font-size:0.75rem; color:#8b949e; margin-bottom:8px;">Última actualización: \${new Date(stored).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' })}\</p>\` : '';
        const remainingDates = Utils.getRemainingDates();
        
        let html = \`\${lastUpdateText}<p class="note">Puntos acumulados (Dinámico) · Top \${CONFIG.TOP_CUTOFF} → Nov 29 · \${remainingDates} fechas</p>\`;
        computedPlayers.forEach((p, index) => {
          const rank = index + 1;
          let rankClass = "rk" + (rank <= 3 ? \` r\${rank}\` : "");
          html += \`
          <div class="row \${p.isMe ? 'me' : ''}">
            <span class="\${rankClass}">\${rank}</span>
            <span class="nm">\${p.name}</span>
            <span class="pt">\${p.pts}</span>
            \${!p.isMe ? \`<button class="btn-icon-del" style="opacity:0.6; font-size:0.8rem" onclick="State.mergePlayers('\${p.name.replace(/'/g, "\\\\'")}')" title="Fusionar con otro jugador">⚙️</button>\` : ""}
          </div>\`;
          if (rank === CONFIG.TOP_CUTOFF) html += \`<div class="cutline">— top \${CONFIG.TOP_CUTOFF} · clasificados —</div>\`;
        });
        if (container) container.innerHTML = html;

        const myData = computedPlayers.find(p => p.isMe);
        if (myData) {
          const myRank = computedPlayers.findIndex(p => p.isMe) + 1;
          if (document.getElementById("stat-pts")) document.getElementById("stat-pts").textContent = myData.pts;
          if (document.getElementById("stat-rank")) document.getElementById("stat-rank").textContent = \`\${myRank}°\`;
        }
      },`;
    html = replaceFunction(html, '      renderLeaderboard() {', '        }\n      },', newRenderLeaderboard);
    
    // Add toggleTestMode to UI
    const newUiSwitchPage = `      toggleTestMode() {
        const toggle = document.getElementById('test-mode-toggle');
        const banner = document.getElementById('test-mode-banner');
        CONFIG.isTestMode = toggle.checked;
        
        if (CONFIG.isTestMode) {
            banner.style.display = 'block';
            // Start fresh test environment
            State.resetToDefaults();
            State.save();
        } else {
            banner.style.display = 'none';
            // Clean up test data
            localStorage.removeItem('pauper_test_players');
            localStorage.removeItem('pauper_test_historic');
        }
        
        State.load();
        UI.refreshAll();
      },

      switchPage(id, btn) {`;
      
    html = html.replace('      switchPage(id, btn) {', newUiSwitchPage);

    fs.writeFileSync('index.html', html, 'utf8');
    console.log("Refactor applied successfully.");

} catch(e) {
    console.error("Error applying refactor:", e);
}
