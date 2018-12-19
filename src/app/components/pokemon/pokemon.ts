import {Iv} from './iv';
import {ReferenceDataService} from '../../providers/reference-data.service';

export class Pokemon {
  pokedexId: number;
  pid: number;
  formId: number;
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
  catchYear: number;
  levelUp: boolean;
  possibleIVs: Iv[];

  constructor(private referenceDataService: ReferenceDataService) {
  }

  get image() {
    return this.pid
      ? `assets/img/pokemon/${this.pid.toString().padStart(3, '0')}.png`
      : undefined;
  }

  get isCorrectlyDetected() {
    return this.formId !== -1
      && this.cp !== -1
      && this.hp !== -1
      && this.dust !== -1
      && this.level !== -1;
  }

  get minIv() {
    if (!this.possibleIVs) {
      this.computeIv();
    }
    return this.possibleIVs ? Math.min(...this.possibleIVs.map(iv => iv.iv)) : null;
  }

  get maxIv() {
    if (!this.possibleIVs) {
      this.computeIv();
    }
    return this.possibleIVs ? Math.max(...this.possibleIVs.map(iv => iv.iv)) : null;
  }

  get imc(): number {
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

    const ECpM = this.referenceDataService.getCPM()[this.level - 1];

    // const data = pokemonData[this.pokedexId - 1];
    const data = this.referenceDataService.getPokemonData()[this.pid];
    this.possibleIVs = [];
    if (data) {
      const {stamina, attack, defense} = data;

      for (let hp = minHP; hp <= maxHP; hp++) {
        let thp = Math.floor(ECpM * (stamina + hp));
        thp = thp < 10 ? 10 : thp;
        if (thp === this.hp) {
          for (let atk = minATK; atk <= maxATK; atk++) {
            for (let def = minDEF; def <= maxDEF; def++) {
              let cp = Math.floor((attack + atk) * Math.pow(defense + def, 0.5) * Math.pow(stamina + hp, 0.5) * Math.pow(ECpM, 2) / 10);
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
}
