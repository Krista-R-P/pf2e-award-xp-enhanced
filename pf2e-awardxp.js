/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Open dialog at when the preDeleteCombat hook is fired.
 */

Hooks.on('preDeleteCombat', (combat,html,id) => {
    if (!game.user.isGM) return
    if (!game.settings.get("pf2e-award-xp", "combatPopup")) return
    const pcs = combat.combatants.filter(c => c.actor.type==='character' && c.actor.alliance === 'party' && !c.actor.traits.has('eidolon') && !c.actor.traits.has('minion')).map(c => c.actor)
    
    const encounterParticipants = {};
    pcs.forEach(pc => {
        encounterParticipants[pc.id] = true;
    });
    
    const pwol = game.pf2e.settings.variants.pwol.enabled;
    let calulatedXP = game.pf2e.gm.calculateXP(
        pcs[0].system.details.level.value,
        pcs.length,
        combat.combatants.filter(c => c.actor.alliance === 'opposition').map(c => c.actor.system.details.level.value),
        combat.combatants.filter(c => c.actor.type === "hazard").map(c => c.actor.system.details.level.value),
        {pwol}
    )
    game.pf2e_awardxp.Award.create({
        destinations: game.actors.party.members.filter(m => m.type === "character" &&  !m.traits.has('eidolon') && !m.traits.has('minion')), 
        description: 'Encounter (' + calulatedXP.rating.charAt(0).toUpperCase() +  calulatedXP.rating.slice(1) + ')', 
        xp: calulatedXP.xpPerPlayer,
        encounterParticipants: encounterParticipants
    });
})


Hooks.once("init", async () => {
    console.log('PF2E Award XP Init')
    game.pf2e_awardxp = {openDialog: Award.openDialog,
                        openPlayerDialog: Award.openDialog,
                        Award: Award
                        }
    registerCustomEnrichers();
    registerWorldSettings();

});


Hooks.once("ready", async () => {
    game.pf2e_awardxp.Award._welcomeMessage();
    
    // Add floating Award XP button for GMs
    if (game.user.isGM) {
        addFloatingAwardButton();
    }
});

function addFloatingAwardButton() {
    const floatingButton = $(`
        <button class="ui-control fa-solid" id="award-xp-floating-button" type="button" title="Award Experience Points">
            <i class="fa-solid fa-trophy"></i>
        </button>
    `);

    floatingButton.on("click", () => {
        game.pf2e_awardxp.Award.create({});
    });

    const targetContainer = document.querySelector('body > div#interface > section#ui-middle > footer#ui-bottom> aside#hotbar');
    if (targetContainer) {
        targetContainer.appendChild(floatingButton[0]);
    } else {
        console.error("PF2E Award XP - Could not find target container for floating Award XP button.");
    }
}


Hooks.on("chatMessage", (app, message, data) => game.pf2e_awardxp.Award.chatMessage(message));

export function registerCustomEnrichers() {
CONFIG.TextEditor.enrichers.push({
    pattern: /\[\[\/(?<type>award) (?<config>[^\]]+)]](?:{(?<label>[^}]+)})?/gi,
    enricher: enrichAward
})

document.body.addEventListener("click", awardAction);
}

export function registerWorldSettings() { 
    game.settings.register("pf2e-award-xp", "welcomeMessageShown", {
        scope: "world",
        name: "welcomeMessageShown",
        hint: "welcomeMessageShown",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register("pf2e-award-xp", "combatPopup", {
      scope: "world",
      name: "PF2EAXP.Award.combatPopup",
      hint: "PF2EAXP.Award.combatPopupHint",
      config: true,
      type: Boolean,
      default: true
  });

}


/* -------------------------------------------- */
/*  Enrichers                                   */
/* -------------------------------------------- */

/**
 * Enrich an award block displaying amounts for each part granted with a GM-control for awarding to the party.
 * @param {object} config              Configuration data.
 * @param {string} [label]             Optional label to replace default text.
 * @param {EnrichmentOptions} options  Options provided to customize text enrichment.
 * @returns {HTMLElement|null}         An HTML link if the check could be built, otherwise null.
 */

function parseConfig(match) {
    const config = { _config: match, values: [] };
    for ( const part of match.match(/(?:[^\s"]+|"[^"]*")+/g) ) {
      if ( !part ) continue;
      const [key, value] = part.split("=");
      const valueLower = value?.toLowerCase();
      if ( value === undefined ) config.values.push(key.replace(/(^"|"$)/g, ""));
      else if ( ["true", "false"].includes(valueLower) ) config[key] = valueLower === "true";
      else if ( Number.isNumeric(value) ) config[key] = Number(value);
      else config[key] = value.replace(/(^"|"$)/g, "");
    }
    return config;
  }


async function enrichAward(match, options) {
    let { type, config, label } = match.groups;
    config = parseConfig(config);
    config._input = match[0];
   const command = config._config;

   const block = document.createElement("span");
   block.classList.add("award-block", "pf2eaxp");
   block.dataset.awardCommand = command;
 
   block.innerHTML += `<a class="award-link" data-action="awardRequest">
     <i class="fa-solid fa-trophy"></i> ${label ?? game.i18n.localize("PF2EAXP.Award.Action")}
   </a>
 `;

    return block;
  }

  /* -------------------------------------------- */


/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

/**
 * Forward clicks on award requests to the Award application.
 * @param {Event} event  The click event triggering the action.
 * @returns {Promise|void}
 */

async function awardAction(event) {
    const target = event.target.closest('[data-action="awardRequest"]');
    const command = target?.closest("[data-award-command]")?.dataset.awardCommand;
    if ( !command ) return;
    event.stopPropagation();
    Award.handleAward(command);
  }
  
class Award extends foundry.applications.api.DialogV2 {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
          classes: ["pf2e", "award", "dialog","pf2eawardxp"],
          tag: "dialog",
          window: {
            title: "PF2EAXP.Award.Title",
            icon: "fa-solid fa-trophy",
            minimizable: false
          },
          position: {
            width: 400,
            height: "auto"
          }
        });
      }

      static async create(options = {}) {
        const xp = options.xp ?? 0;
        const description = options.description ?? null;
        const destinations = options.destinations?.length > 0 ? options.destinations : game.actors.party.members.filter(m => m.type === "character" &&  !m.traits.has('eidolon') && !m.traits.has('minion'));
        const encounterParticipants = options.encounterParticipants ?? null;
        
        const content = await foundry.applications.handlebars.renderTemplate("modules/pf2e-award-xp/templates/apps/award.hbs", {
          xp,
          description,
          destinations,
          encounterParticipants
        });

        return new Promise((resolve, reject) => {
          new this({
            content,
            window: {
              title: game.i18n.localize("PF2EAXP.Award.Title"),
              icon: "fa-solid fa-trophy"
            },
            buttons: [
              {
                action: "award",
                icon: "fa-solid fa-trophy",
                label: game.i18n.localize("PF2EAXP.Award.Action"),
                callback: (event, button, dialog) => this._onAward(event, button, dialog, resolve)
              },
              {
                action: "cancel",
                icon: "fas fa-times",
                label: "Cancel",
                callback: () => resolve(null)
              }
            ],
            default: "award",
            close: () => resolve(null)
          }).render(true);
        });
      }

      static async _onAward(event, button, dialog, resolve) {
        const formData = new FormData(dialog.element.querySelector("form"));
        const data = foundry.utils.expandObject(Object.fromEntries(formData));
        
        console.log("PF2E Award XP - Form data:", data);
        console.log("PF2E Award XP - XP amount:", data.xp, "Type:", typeof data.xp);
        
        // Get destinations
        const destinations = []
        for (const actor in data.destination){ 
            if (data.destination[actor]) destinations.push(game.actors.get(actor))
        }
        
        button.disabled = true;

        if(data['award-type'] != "Custom") {data.description = data['award-type'];}
        
        console.log("PF2E Award XP - Destinations found:", destinations.length);
        console.log("PF2E Award XP - User is GM:", game.user.isGM);
        
        if (game.user.isGM){
            console.log("PF2E Award XP - Calling awardXP with:", data.xp, destinations);
            await this.awardXP(data.xp, destinations)
            await this.displayAwardMessages(data.xp, data.description, destinations);
        }
        
        resolve({data, destinations});
      }
    
    /**
    * Update the actors with the current EXP value.
    * @param {integer} amount  value of EXP to grant.
    * @param {array[actors]} destinations  text description to be displayed in chatMessage.
    */
    static async awardXP(amount, destinations){
        console.log("PF2E Award XP - awardXP called with amount:", amount, "destinations:", destinations.length);
        
        if ( !amount || !destinations.length ) {
            console.log("PF2E Award XP - Early return: amount =", amount, "destinations.length =", destinations.length);
            return;
        }
        
        for ( const destination of destinations ) {
          try {
            const currentXP = destination.system.details.xp.value;
            const newXP = currentXP + parseInt(amount);
            console.log(`PF2E Award XP - ${destination.name} - ${currentXP}(starting) +  ${amount} (award) = ${newXP} (total)`)
            await destination.update({'system.details.xp.value': newXP})
            console.log(`PF2E Award XP - Successfully updated ${destination.name}`);
          } catch(err) {
            console.error(`PF2E Award XP - Error updating ${destination.name}:`, err);
            ui.notifications.warn(destination.name + ": " + err.message);
          }
        }
    }

    /**
    * Send the ChatMessage from the template file.
    * @param {integer} amount  value of EXP to grant.
    * @param {string} description  text description to be displayed in chatMessage.
    * @param {array[actors]} destinations  text description to be displayed in chatMessage.
    */
    static async displayAwardMessages(amount, description, destinations) {
        const hasDescription = description && description.trim() !== '';
        
        let message;
        if (hasDescription) {
            message = game.i18n.format("PF2EAXP.Award.Message", {
                name: game.actors.party.name, 
                award: amount, 
                description: description 
            });
        } else {
            message = game.i18n.format("PF2EAXP.Award.MessageNoDescription", {
                name: game.actors.party.name, 
                award: amount
            });
        }
        
        const context = {
            message: message,
            destinations: destinations
        }
        const content = await foundry.applications.handlebars.renderTemplate("modules/pf2e-award-xp/templates/chat/party.hbs", context);
    
        const messageData = {
          type: CONST.CHAT_MESSAGE_STYLES["OTHER"],
          content: content,
          speaker: ChatMessage.getSpeaker({actor: this.parent}),
          rolls: null,
        }
        return ChatMessage.create(messageData, {});
    }

  /* -------------------------------------------- */
  /*  Event Handling                              */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);
    
    const html = this.element;
    
    const validateForm = () => {
        const awardButton = html.querySelector('[data-action="award"]');
        if (!awardButton) return;

        let isValid = true;

        const xpInput = html.querySelector('[name=xp]');
        const xpAmount = parseInt(xpInput?.value || 0);
        if (!xpAmount || xpAmount <= 0) {
            isValid = false;
        }

        const reasonSelect = html.querySelector('[name=award-type]');
        const selectedReason = reasonSelect?.value;
        if (!selectedReason || selectedReason.trim() === '' || selectedReason === 'Choose Reason') {
            isValid = false;
        }

        const checkboxes = html.querySelectorAll('[name^="destination."]');
        const hasSelection = Array.from(checkboxes).some(cb => cb.checked);
        if (!hasSelection) {
            isValid = false;
        }

        awardButton.disabled = !isValid;
    };

    validateForm();
    
    html.querySelector('[name=award-type]')?.addEventListener("change", function() {
        const xpInput = html.querySelector('[name=xp]');
        if (xpInput) xpInput.value = this.selectedOptions[0].getAttribute("data-xp");
        
        const customBox = html.querySelector(".pf2e_awardxp_description input");
        if (customBox) {
          if (this.selectedOptions[0].value == "Custom"){
             customBox.disabled = false;
          } else { 
             customBox.disabled = true;
             customBox.value = this.selectedOptions[0].value;
          }
        }
        
        validateForm();
    });

    html.querySelector('[name=xp]')?.addEventListener("input", validateForm);

    html.querySelector('[name=description]')?.addEventListener("input", validateForm);

    html.querySelectorAll('[name^="destination."]').forEach(checkbox => {
        checkbox.addEventListener('change', validateForm);
    });

    const encounterToggle = html.querySelector('#encounter-only');
    if (encounterToggle) {
        encounterToggle.addEventListener('change', function() {
            const onlineToggle = html.querySelector('#online-players-only');
            if (this.checked && onlineToggle) {
                onlineToggle.checked = false;
            }
            
            const checkboxes = html.querySelectorAll('[name^="destination."]');
            checkboxes.forEach(checkbox => {
                const isParticipant = checkbox.getAttribute('data-encounter-participant') === 'true';
                if (this.checked) {
                    checkbox.checked = isParticipant;
                } else {
                    checkbox.checked = true;
                }
            });
            
            validateForm();
        });
    }

    const onlinePlayersToggle = html.querySelector('#online-players-only');
    if (onlinePlayersToggle) {
        onlinePlayersToggle.addEventListener('change', function() {
            const encounterToggle = html.querySelector('#encounter-only');
            if (this.checked && encounterToggle) {
                encounterToggle.checked = false;
            }
            
            const checkboxes = html.querySelectorAll('[name^="destination."]');
            checkboxes.forEach(checkbox => {
                const actorId = checkbox.name.split('.')[1];
                const actor = game.actors.get(actorId);
                
                if (this.checked) {
                    const isOwnerOnline = actor?.ownership && Object.keys(actor.ownership).some(userId => {
                        if (userId === 'default') return false;
                        const user = game.users.get(userId);
                        return user && user.active && !user.isGM && actor.ownership[userId] >= 3;
                    });
                    checkbox.checked = isOwnerOnline;
                } else {
                    checkbox.checked = true;
                }
            });
            validateForm();
        });
    }
  }



  /* -------------------------------------------- */
  /*  Chat Command                                */
  /* -------------------------------------------- */

  /**
   * Regular expression used to match the /award command in chat messages.
   * @type {RegExp}
   */
  static COMMAND_PATTERN = new RegExp(/^\/award(?:\s|$)/i);

  /* -------------------------------------------- */

  /**
   * Regular expression used to split currency & xp values from their labels.
   * @type {RegExp}
   */
  //static VALUE_PATTERN = new RegExp(/^(.+?)(\D+)$/);
  static VALUE_PATTERN = new RegExp(/^(\d+)(.*)/);

  /* -------------------------------------------- */

  /**
   * Use the `chatMessage` hook to determine if an award command was typed.
   * @param {string} message   Text of the message being posted.
   * @returns {boolean|void}   Returns `false` to prevent the message from continuing to parse.
   */
  static chatMessage(message) {
    if ( !this.COMMAND_PATTERN.test(message) ) return;
    this.handleAward(message);
    return false;
  }


    /**
   * Parse the award command and grant an award.
   * @param {string} message  Award command typed in chat.
   */
  static async handleAward(message) {
    if ( !game.user.isGM ) {
        ui.notifications.error("PF2EAXP.Award.NotGMError", { localize: true });
        return;
      }

      try {
        const { xp, description } = this.parseAwardCommand(message);
        game.pf2e_awardxp.Award.create({xp:parseInt(xp), description:description});

      } catch(err) {
        ui.notifications.warn(err.message);
      }

  }

    /**
   * Parse the award command and grant an award.
   * @param {string} message  Award command typed in chat.
   */
  static parseAwardCommand(message) {
    const command = message.replace(this.COMMAND_PATTERN, "");
    let [full, xp, description] = command.match(this.VALUE_PATTERN) ?? [];
    return { xp, description };
  }

    /**
   * Use the `openDialog` method is a shim to removed in a furture update.
   */ 
  static openDialog(options={}) { 
    if ( !game.user.isGM ) {
        ui.notifications.error("PF2EAXP.Award.NotGMError", { localize: true });
        return;
      }
      
    let xp = options.award ?? null;
    let description = options.description ?? null;
    return game.pf2e_awardxp.Award.create({xp:xp, description:description});

  }


  static _welcomeMessage() {
        if (!game.settings.get("pf2e-award-xp", "welcomeMessageShown")) {
            if (game.user.isGM) {
                const content = [`
                <div class="pf2eawardxp">
                    <h3 class="nue">${game.i18n.localize("PF2EAXP.Welcome.Title")}</h3>
                    <p class="nue">${game.i18n.localize("PF2EAXP.Welcome.WelcomeMessage1")}</p>
                    <p class="nue">${game.i18n.localize("PF2EAXP.Welcome.WelcomeMessage2")}</p>
                    <p>
                        ${game.i18n.localize("PF2EAXP.Welcome.WelcomeEnricherJank")}
                    </p>
                    <p class="nue">${game.i18n.localize("PF2EAXP.Welcome.WelcomeMessageOutput")}</p>
                    <p>
                        ${game.i18n.localize("PF2EAXP.Welcome.WelcomeEnricher")}
                    </p>
                    <p class="nue">${game.i18n.localize("PF2EAXP.Welcome.WelcomeMessage3")}</p>
                    <p>
                        ${game.i18n.localize("PF2EAXP.Welcome.WelcomeCommand")}
                    </p>
                    <p class="nue"></p>
                    <footer class="nue"></footer>
                </div>
                `];
                const chatData = content.map(c => {
                    return {
                        whisper: [game.user.id],
                        speaker: { alias: "PF2E Award Exp" },
                        flags: { core: { canPopout: true } },
                        content: c
                    };
                });
                ChatMessage.implementation.createDocuments(chatData);
                game.settings.set("pf2e-award-xp", "welcomeMessageShown", true)
            }
        }

  }


}