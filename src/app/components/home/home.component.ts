import {Component, NgZone, OnInit} from '@angular/core';
import {Pokemon} from '../pokemon/pokemon';
import TimeUtils from '../../utils/timeUtils';
import {AdbService} from '../../providers/adb.service';
import ClipperService from '../../providers/clipper.service';
import CalcyIVService from '../../providers/calcyIV.service';
import PogoService from '../../providers/pogo.service';
import Button from '../../dto/button';
import PokemonDetailScreen from '../../dto/screen/pokemonDetailScreen';

import * as Tesseract from 'tesseract.js';
import ImageUtils from '../../utils/imageUtils';
import * as convert from 'color-convert';
import {pokemonFr} from '../../pokemon-fr';

import levenshtein from 'js-levenshtein';
import {filter, map} from 'rxjs/operators';
import {Observable} from 'rxjs';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  public devices: string[];
  public pokemons: Pokemon[] = [];
  public screenshot: string;
  private calcyIVButton: Button;
  private pokemonDetailScreen: any;
  public evalInProgress: boolean;
  private tesseract: Tesseract.TesseractStatic;
  private detectedPokemons: Observable<Pokemon>;

  constructor(private adbService: AdbService,
              private calcyIVService: CalcyIVService,
              private clipperService: ClipperService,
              private pogoService: PogoService,
              private zone: NgZone) {
  }

  async ngOnInit() {
    await this.adbService.init();
    this.devices = await this.adbService.devices();

    const tesseractVersion = '1.0.10';
    this.tesseract = Tesseract.create({
      workerPath: `https://cdn.rawgit.com/naptha/tesseract.js/${tesseractVersion}/dist/worker.js`,
      corePath: 'https://cdn.rawgit.com/naptha/tesseract.js-core/0.1.0/index.js',
      langPath: 'https://cdn.rawgit.com/naptha/tessdata/gh-pages/3.02/',
    });

    this.detectedPokemons = this.calcyIVService.logs$
      .pipe(
        filter(log => log.includes('Received values:')),
        map(log => {
          const regexMath = /Received values: Id: ([^,]*), CP: ([^,]*), Max HP: ([^,]*), Dust cost: ([^,]*), Level: ([^,]*), FastMove ([^,]*), SpecialMove ([^,]*), Gender ([^,]*)/.exec(log);
          if (regexMath) {
            const [, idString, cp, hp, dust, level, fastMove, specialMove, gender] = regexMath;
            const [, id, name] = /(\d*) \(([^\)]*)\)/.exec(idString);

            const pokemon = new Pokemon();
            pokemon.pokedexId = Number.parseInt(id) + 1;
            pokemon.name = name;
            pokemon.cp = Number.parseInt(cp);
            pokemon.hp = Number.parseInt(hp);
            pokemon.dust = Number.parseInt(dust);
            pokemon.level = Number.parseInt(level);
            pokemon.fastMove = fastMove;
            pokemon.specialMove = specialMove;
            pokemon.gender = Number.parseInt(gender);
            return pokemon;
          } else {
            console.error(`Doesn't match regexp: `, log);
          }
        })
      );
  }

  private async initClipper() {
    if (!await this.clipperService.isInstalled()) {
      console.log('We need to install "Clipper" app on your device. Press any key to continue');
      await this.clipperService.install();
    }
    await this.clipperService.start();
  }

  async startPokemonsEval() {
    await this.initClipper();

    await this.calcyIVService.startIfNotRunning();
    this.calcyIVButton = await this.calcyIVService.findButton();
    console.log(this.calcyIVButton);

    const screen = await this.pogoService.getCurrentScreen();
    if (screen instanceof PokemonDetailScreen) {
      this.pokemonDetailScreen = screen;
      this.evalInProgress = true;

      const subscription = this.detectedPokemons
        .subscribe(async p => {
          if (p.isCorrectlyDetected) {
            p.renamed = await this.clipperService.get();

            this.zone.run(async () => {
              console.log(p);
              this.pokemons.push(p);
            });
            await this.pogoService.nextPokemon();
            await TimeUtils.wait(500);
          }
          if (this.evalInProgress) {
            await this.adbService.tap(await this.calcyIVButton.coordinates);
          } else {
            subscription.unsubscribe();
          }
        });
      await this.adbService.tap(await this.calcyIVButton.coordinates);
    } else {
      console.log('Not in the right screen');
    }
  }

  // async startPokemonsEval() {
  //   await this.initClipper();
  //
  //   await this.calcyIVService.startIfNotRunning();
  //   this.calcyIVButton = await this.calcyIVService.findButton();
  //   console.log(this.calcyIVButton);
  //
  //   const screen = await this.pogoService.getCurrentScreen();
  //   if (screen instanceof PokemonDetailScreen) {
  //     this.pokemonDetailScreen = screen;
  //     this.evalInProgress = true;
  //     while (this.evalInProgress) {
  //       const pokemon = new Pokemon();
  //       this.pokemons.push(pokemon);
  //
  //       this.detectPokemonInfoFromScreenshot(pokemon);
  //
  //       const outputStatus = await this.evalPokemon();
  //       pokemon.name = outputStatus.clipboard;
  //       await this.adbService.tap(outputStatus.coordinates);
  //       await this.pogoService.nextPokemon();
  //       await TimeUtils.wait(500);
  //     }
  //   } else {
  //     console.log('Not in the right screen');
  //   }
  // }

  private async detectPokemonInfoFromScreenshot(pokemon) {
    const image = await this.adbService.screenshot();

    const {height, width} = image.bitmap;

    let headerHeight;
    for (let y = Math.round(0.25 * height); y < 0.5 * height; y++) {
      const pixel = ImageUtils.findContinuousPixelsOfColorOnLine(image, 0xfafafaff, 50);
      if (pixel) {
        headerHeight = pixel[1];
        break;
      }
    }

    image.scan(0, 0, width, height, (x, y, idx) => {
      const [r, g, b] = convert.hex.rgb(image.getPixelColor(x, y));
      let condition;
      if (y < headerHeight) {
        condition = r <= 235 || g <= 235 || b <= 235;
      } else {
        condition = r > 200 || g > 200 || b > 200;
      }
      const color = condition ? 0xffffffff : 0x000000ff;
      image.setPixelColor(color, x, y);
    });

    image.write(`log/${Date.now()}.png`);

    image.getBuffer('image/png', (err, buffer) => {
      this.tesseract.recognize(new Blob([new Uint8Array(buffer)]), {
        lang: 'fra',
        // tessedit_write_images: '1'
        // tessedit_pageseg_mode: '11'
      })
        .then((result) => {
          console.log(result.text);

          pokemon.pc = Number.parseInt(
            // result.lines[0].symbols
            //   .map(s => {
            //     const v = s.choices.filter(c => /\d/.test(c.text) && c.confidence > 75);
            //     if (v.length) {
            //       return v[0].text;
            //     }
            //   }).join('')
            result.lines[0].text
              .replace(/o/ig, '0')
              .replace(/l/ig, '1')
              .replace(/ô/ig, '6')
              .replace(/[^\d]/g, '')
          );

          const candyMatch = /bonbons([^\n]+)/ig.exec(result.text);
          if (candyMatch) {
            const pokemonName = candyMatch[1].trim().toLowerCase();
            const foundPokemon = pokemonFr
              .map(p => ({...p, d: levenshtein(pokemonName, p.name)}))
              .sort((p1, p2) => p1.d - p2.d)
              [0];
            pokemon.pokedexId = Number.parseInt(foundPokemon.id);
          }

          const weightAndSize = /([\d\.]+)kg\s*([\d\.]+)m/ig.exec(result.text);
          if (weightAndSize) {
            const weight = weightAndSize[1];
            const size = weightAndSize[2];
            pokemon.weight = Number.parseFloat(weight);
            pokemon.size = Number.parseFloat(size);
          }

          console.log(pokemon);
        });
    });
  }

  stopPokemonsEval() {
    this.evalInProgress = false;
  }


// async evalPokemon(): Promise<OutputStatus> {
//   let outputStatus;
//   do {
//     await this.adbService.tap(await this.calcyIVButton.coordinates);
//     outputStatus = await this.calcyIVService.outputStatus();
//     if (outputStatus.isOk) {
//       console.log(outputStatus.clipboard);
//
//       const ivFromToRegex = '[0-9]+-([0-9]+)';
//       const ivCombApproxRegex = '[\u{24FF}\u{2776}-\u{277F}\u{24EB}-\u{24EF}]+';
//       const impreciseIvRegex = new RegExp(`${ivFromToRegex}|${ivCombApproxRegex}`, 'u');
//       const impreciseIv = impreciseIvRegex.exec(outputStatus.clipboard);
//       if (impreciseIv && (!impreciseIv[1] || Number.parseInt(impreciseIv[1]) > 90)) {
//         console.log('TODO: should appraise!');
//       }
//
//       // if (this.pokemonDetailScreen.renameButton.coordinates[1] >= outputStatus.coordinates[1]) {
//       //   await TimeUtils.wait(150);
//       //   await outputStatus.click();
//       //   await TimeUtils.wait(300);
//       // } else {
//       //   await outputStatus.click();
//       // }
//       //
//       // const pasteCapability = true;
//       // if (pasteCapability) {
//       //   await this.pokemonDetailScreen.renameButton.click();
//       //   await this.adb.paste();
//       //   await this.pogo.hideKeyboard();
//       //   await this.pogo.clickOkOnRenameDialog();
//       //   await TimeUtils.wait(600);
//       // }
//     }
//   } while (!outputStatus.isOk && this.evalInProgress);
//   return outputStatus;
// }

  async takeScreenshot() {
    const image = await this.adbService.screenshot() as any;
    image.getBase64('image/png', (err, src) => {
      this.zone.run(() => {
        this.screenshot = src;
      });
    });
}
}