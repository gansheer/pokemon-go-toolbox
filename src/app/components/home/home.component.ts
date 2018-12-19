import {Component, NgZone, OnInit} from '@angular/core';
import {Pokemon} from '../pokemon/pokemon';
import TimeUtils from '../../utils/timeUtils';
import {AdbService} from '../../providers/adb.service';
import {ClipperService} from '../../providers/clipper.service';
import {CalcyIVService} from '../../providers/calcyIV.service';
import {PogoService} from '../../providers/pogo.service';
import PokemonDetailScreen from '../../dto/screen/pokemonDetailScreen';
import {filter, map} from 'rxjs/operators';
import {Observable} from 'rxjs';
import {DevicesService} from '../../providers/devices.service';
import {ReferenceDataService} from '../../providers/reference-data.service';

interface PokemonName {
  pid: number;
  name: string;
  locale: string;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  public pokemons: Pokemon[] = [];
  public screenshot: string;
  public evalInProgress: boolean;
  public minIv = 90;
  public selectedPokemon: Pokemon;

  private pokemonDetailScreen: PokemonDetailScreen;
  private detectedPokemons: Observable<Pokemon>;

  private standardPokemonNames: PokemonName[];
  private specialPokemonNames: PokemonName[];
  private alola: { pid: number; name: string; locale: string; originalName: string; originalId: number }[];
  private pokedex: { [id: number]: PokemonName[] };

  constructor(private devicesService: DevicesService,
              private adbService: AdbService,
              private calcyIVService: CalcyIVService,
              private clipperService: ClipperService,
              private pogoService: PogoService,
              private referenceDataService: ReferenceDataService,
              private zone: NgZone) {
  }

  async ngOnInit() {
    const names = this.referenceDataService.getPokemonNames().filter(p => p.locale === 'fr');
    this.standardPokemonNames = names.filter(p => p.pid < 10000);
    this.specialPokemonNames = names.filter(p => p.pid >= 10000);

    this.pokedex = this.standardPokemonNames.reduce((prev, current) => {
      prev[current.pid] = [current];
      return prev;
    }, {});
    names.filter(p => p.pid >= 10000).forEach(p => {
      const pokemonName = /M\. /i.test(p.name) ? p.name.split(' ').slice(0, 2).join(' ') : p.name.split(' ')[0];
      const foundPokemon = this.standardPokemonNames.find(sp => sp.name === pokemonName);
      this.pokedex[foundPokemon.pid].push(p);
    });

    this.alola = this.specialPokemonNames
      .filter(p => /alola/i.test(p.name))
      .map(p => ({...p, originalName: p.name.split(' ')[0]}))
      .map(p => ({...p, originalId: this.standardPokemonNames.find(sp => sp.name === p.originalName).pid}));

    this.devicesService.devices
      .forEach(device => device.connected$.subscribe(status => console.log(`${device.id}: ${status}`)));

    this.detectedPokemons = this.calcyIVService.streamCalcyIvLogs()
      .pipe(
        filter(log => log.includes('Received values:')),
        map((log: string) => {
          const regexMath = /Received values: (.*)/.exec(log);
          if (regexMath) {
            const receivedValues: any = regexMath[1].split(',').map(v => v.trim()).reduce((acc, receivedValue) => {
              let [key, value] = receivedValue.split(':').map(v => v.trim());
              if (!value) {
                [key, value] = key.split(' ');
              }
              acc[key.replace(/[- ]/g, '')] = value;
              return acc;
            }, {});

            const [, id, pokemonName] = /(\d*) \(([^\)]*)\)/.exec(receivedValues.Id);

            const pokemon = new Pokemon(this.referenceDataService);
            pokemon.formId = Number.parseInt(id, 10);
            pokemon.name = pokemonName;
            pokemon.pokedexId = Number.parseInt(receivedValues.Nr, 10);

            if (pokemon.pokedexId > 0) {
              const foundPokemon = this.findPokemon(pokemon.pokedexId, pokemonName);
              pokemon.pid = foundPokemon.pid;
            }

            pokemon.cp = Number.parseInt(receivedValues.CP, 10);
            pokemon.hp = Number.parseInt(receivedValues.MaxHP, 10);
            pokemon.dust = Number.parseInt(receivedValues.Dustcost, 10);
            pokemon.level = Number.parseInt(receivedValues.Level, 10);
            pokemon.fastMove = receivedValues.FastMove;
            pokemon.specialMove = receivedValues.SpecialMove;
            pokemon.gender = Number.parseInt(receivedValues.Gender, 10);
            pokemon.catchYear = Number.parseInt(receivedValues.catchYear, 10);
            pokemon.levelUp = receivedValues.Levelup.toLowerCase() === 'true';
            return pokemon;
          } else {
            console.error(`Doesn't match regexp: `, log);
          }
        })
      );
  }

  private findPokemon(pokedexId: number, pokemonName: string) {
    const pokemonForm = pokemonName
      .replace(/^[^ ]+/, '')
      .replace(/normale/i, '')
      .replace(/alternative/i, '') // For Giratina
      .trim();

    if (pokemonForm) {
      return this.pokedex[pokedexId]
        .find(p => new RegExp(pokemonForm, 'i').test(p.name));
    } else {
      return this.pokedex[pokedexId][0];
    }
  }

  private async initClipper() {
    if (!await this.clipperService.isInstalled()) {
      console.log('We need to install "Clipper" app on your device. Press any key to continue');
      await this.clipperService.install();
    }
    await this.clipperService.start();
  }

  async startPokemonsEval() {
    this.evalInProgress = true;
    await this.initClipper();

    const screen = await this.pogoService.getCurrentScreen();
    if (screen instanceof PokemonDetailScreen) {
      console.log('On the right screen. Evaluation will start!');
      this.pokemonDetailScreen = screen;

      const subscription = this.detectedPokemons
        .subscribe(async p => {
          if (p.isCorrectlyDetected) {
            this.clipperService.get().then(name => {
              this.zone.run(async () => {
                p.renamed = name;
              });
            });

            this.zone.run(async () => {
              console.log(p);
              this.pokemons.push(p);
            });

            if (p.maxIv >= this.minIv) {
              await this.adbService.tap(this.pokemonDetailScreen.renameButton.coordinates);
              await this.adbService.paste();
              await this.pogoService.hideKeyboard();
              await this.pogoService.clickOkOnRenameDialog();
              await TimeUtils.wait(600);
            }

            await this.pogoService.nextPokemon();
            await TimeUtils.wait(300);
          }
          if (this.evalInProgress) {
            await this.calcyIVService.analyzeScreen();
          } else {
            subscription.unsubscribe();
          }
        });
      await this.calcyIVService.analyzeScreen();
    } else {
      console.log('Not in the right screen');
      this.evalInProgress = false;
    }
  }

  stopPokemonsEval() {
    this.evalInProgress = false;
  }

  async takeScreenshot() {
    const image = await this.adbService.screenshot() as any;
    image.getBase64('image/png', (err, src) => {
      this.zone.run(() => {
        this.screenshot = src;
      });
    });
  }

  async test() {
    this.takeScreenshot();
    window.setTimeout(() => this.test(), 500);
  }
}
