import {Iv} from './iv';
import {cpm, pokemonData} from './data';

export class Pokemon {
  pokedexId: number;
  name: string;
  renamed: string;
  weight: number;
  size: number;
  cp: number;
  hp: number;
  dust: number;
  level: number;
  fastMove: string;
  specialMove: string;
  gender: number;

  possibleIVs: Iv[] = [];

  get image() {
    return this.pokedexId
      ? `assets/img/pokemon/${this.pokedexId.toString().padStart(3, '0')}.png`
      : undefined;
  }

  get isCorrectlyDetected() {
    return this.pokedexId !== -1
      && this.cp !== -1
      && this.hp !== -1
      && this.dust !== -1
      && this.level !== -1;
  }

  get minIv() {
    if (!this.possibleIVs.length) {
      this.computeIv();
    }
    return Math.min(...this.possibleIVs.map(iv => iv.iv));
  }

  get maxIv() {
    if (!this.possibleIVs.length) {
      this.computeIv();
    }
    return Math.max(...this.possibleIVs.map(iv => iv.iv));
  }

  get imc() {
    return this.weight / (this.size * this.size);
  }

  /**
   * Algorithm inspired from https://pokemongo.gamepress.gg/app/factories/calcData.factory.js
   */
  private computeIv() {
    const minATK = 0;
    const minHP = 0;
    const minDEF = 0;
    const maxATK = 15;
    const maxHP = 15;
    const maxDEF = 15;

    const ECpM = cpm[this.level - 1];

    const {BHP, BATK, BDEF} = pokemonData[this.pokedexId - 1];

    for (let hp = minHP; hp <= maxHP; hp++) {
      let thp = Math.floor(ECpM * (BHP + hp));
      thp = thp < 10 ? 10 : thp;
      if (thp === this.hp) {
        for (let atk = minATK; atk <= maxATK; atk++) {
          for (let def = minDEF; def <= maxDEF; def++) {
            let cp = Math.floor((BATK + atk) * Math.pow(BDEF + def, 0.5) * Math.pow(BHP + hp, 0.5) * Math.pow(ECpM, 2) / 10);
            cp = cp < 10 ? 10 : cp;
            if (cp === this.cp) {
              const possibleIV = new Iv(hp, atk, def);
              this.possibleIVs.push(possibleIV);
            }
          }
        }
      }
    }
  }
}