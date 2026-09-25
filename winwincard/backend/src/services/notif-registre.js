'use strict';

// ════════════════════════════════════════════════════════════════════════════
// REGISTRE DES ENVOIS DE NOTIFICATION (migration 046)
//
// Une ligne par TENTATIVE de push, quelle qu'en soit la source. Répond à la
// seule question du lot : « quelles notifications partent, lesquelles Apple et
// Google acceptent ou refusent ». Avant lui, les envois du cron ne laissaient
// que des console.log Railway, éphémères.
//
// ── RÈGLE ABSOLUE : NE JAMAIS BLOQUER NI RETARDER UN ENVOI ─────────────────
// Le registre est une mesure, pas un maillon. Deux garanties :
//   1. l'écriture a TOUJOURS lieu APRÈS l'envoi — elle ne peut donc rien
//      retarder, l'appel APNs ou Google est déjà parti ;
//   2. aucune erreur d'écriture ne remonte à l'appelant. `enregistrer()` et
//      `Lot.ecrire()` ne rejettent jamais : elles journalisent et rendent la
//      main. Un registre en panne laisse la plateforme envoyer normalement.
//
// ── ÉCRITURES GROUPÉES ─────────────────────────────────────────────────────
// Un insert par LOT, jamais un par push. Un lot = un marchand dans un workflow,
// ou une campagne manuelle. Les surfaces à push unique par événement (scan,
// welcome, ajustement, annulation) écrivent une ligne, directement.
//
// Flush PAR MARCHAND et non en fin de workflow : si le cron meurt en cours de
// route, on ne perd que le marchand en cours au lieu de tout le passage. Le
// coût est le même ordre de grandeur (quelques inserts par passage), la perte
// est bornée.
//
// ── PAS DE JETON EN CLAIR ──────────────────────────────────────────────────
// md5(push_token), natif Postgres, pour rapprocher une ligne du registre d'une
// ligne de device_tokens sans stocker le jeton. Clé de corrélation, pas
// primitive de sécurité.
// ════════════════════════════════════════════════════════════════════════════

const crypto   = require('crypto');
const supabase = require('./supabase');

const TABLE      = 'notification_envois';
// Découpe les inserts volumineux : un lot de plusieurs milliers de lignes
// ferait un corps HTTP démesuré vers PostgREST.
const TAILLE_LOT = 500;

function hacherJeton(pushToken) {
  if (!pushToken) return null;
  return crypto.createHash('md5').update(String(pushToken)).digest('hex');
}

// Traduit ce que rendent les couches d'envoi en { statut, reason, ok }.
// APNs : apns.js attache `apnsStatus` et `apnsReason` à l'erreur (voir apns.js).
// Google : le message porte « … 404: … », on en extrait le code.
// Rien d'exploitable → statut NULL, ce qui veut dire « aucune réponse obtenue »
// et se distingue d'un refus.
function depuisErreur(e) {
  if (!e) return { statut: 200, reason: null, ok: true };
  if (typeof e.apnsStatus === 'number') {
    return { statut: e.apnsStatus, reason: e.apnsReason || null, ok: false };
  }
  if (typeof e.googleStatus === 'number') {
    return { statut: e.googleStatus, reason: (e.message || '').slice(0, 300), ok: false };
  }
  const m = /\b(\d{3})\b/.exec(e.message || '');
  return {
    statut: m ? parseInt(m[1], 10) : null,
    reason: (e.message || 'erreur inconnue').slice(0, 300),
    ok: false,
  };
}

function ligne({ source, marchandId, plateforme, serialNumber, pushToken, lot, erreur }) {
  const { statut, reason, ok } = depuisErreur(erreur);
  return {
    source,
    marchand_id:   marchandId || null,
    plateforme,
    statut,
    reason,
    ok,
    token_hash:    hacherJeton(pushToken),
    serial_number: serialNumber || null,
    lot:           lot || null,
  };
}

// Écriture effective. NE REJETTE JAMAIS. §3.9 : supabase-js ne rejette pas non
// plus — on lit `error` explicitement, sinon l'échec serait invisible, ce qui
// est précisément le défaut que ce lot corrige ailleurs dans le code.
async function _inserer(lignes) {
  for (let i = 0; i < lignes.length; i += TAILLE_LOT) {
    const tranche = lignes.slice(i, i + TAILLE_LOT);
    try {
      const { error } = await supabase.from(TABLE).insert(tranche);
      if (error) console.error(`[notif-registre] insert (${tranche.length} l.):`, error.message);
    } catch (e) {
      console.error('[notif-registre] insert exception:', e.message);
    }
  }
}

// ── Lot : accumule puis écrit une fois ────────────────────────────────────
class Lot {
  constructor(source, marchandId) {
    this.source     = source;
    this.marchandId = marchandId || null;
    this.id         = crypto.randomUUID();
    this.lignes     = [];
  }

  ajouter({ plateforme, serialNumber, pushToken, erreur }) {
    this.lignes.push(ligne({
      source: this.source, marchandId: this.marchandId,
      plateforme, serialNumber, pushToken, lot: this.id, erreur,
    }));
  }

  get taille() { return this.lignes.length; }

  // À appeler APRÈS tous les envois du lot. Ne rejette jamais.
  async ecrire() {
    if (!this.lignes.length) return 0;
    const n = this.lignes.length;
    await _inserer(this.lignes);
    this.lignes = [];
    return n;
  }
}

function creerLot(source, marchandId) { return new Lot(source, marchandId); }

// ── Écriture unitaire, pour les surfaces à un push par événement ───────────
// Ne rejette jamais. N'est jamais attendue par un chemin d'envoi.
async function enregistrer(infos) {
  await _inserer([ligne(infos)]);
}

module.exports = { creerLot, enregistrer, hacherJeton, TAILLE_LOT };
