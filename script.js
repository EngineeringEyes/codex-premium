let select = e => document.querySelector(e);
let selectAll = e => document.querySelectorAll(e);

let split = [[],[],[]];
let splitTp = [[],[],[]];
let hasWritten = [false,false,false];

window.onload = (event) => {
    init();
}

function init() {

    let codeDivs = selectAll("code");
	
    /* For each card */
    codeDivs.forEach( ( codeDiv, i ) => {
			
				/* split text and save in sequencing arrays */
        let tp = codeDiv.querySelectorAll(".tp");
        split[i].push(tp);
        split[i].forEach( ( tp ) => {
            let splitText = new SplitText(tp, { type:"chars" });
            gsap.set( splitText.chars, { opacity: 0 });
            splitTp[i].push(splitText);
        });
			
				/* setup strollTrigger for text in each card */
        gsap.to( "body", {

            scrollTrigger: {
                trigger: codeDivs[i],
                start: "top bottom-=100",
                scrub: true,
                onEnter: (self) =>  writeText( i, 0 )
            }

        });
        
    });
	
		/* text reveal recursive function */
    function writeText( i, j ) {

        if( !hasWritten[i] && ( j < 200 ) )
        {

					let tp = split[i][j];
					let splitText = splitTp[i][j];
					gsap.timeline({ defaults: { repeatDelay: 0 }, onComplete:() => {
						
							let nextTd = j + 1;
							if( split[i][nextTd] )
									writeText( i, nextTd );
              else
							{
              	hasWritten[i] = true;
								return;
							}
						
					} })
					.set( splitText.chars, {
							opacity: 1,
							stagger: 0.01
					});
					
				}
				else
					return;

    }

    gsap.set("main", { autoAlpha:1 });

}

/* main GSAP scrollTrigger to move lines forward */
/* parallax scroll background */
gsap.to( "body", {

    scrollTrigger: {
        trigger: "body",
        start: "top top",
        end: "bottom bottom",
        scrub: true,
        onUpdate: (self) => {

            let thisProgress = self.progress;
            let tabletVerMovement = 0.65 * window.innerHeight;

            let scrollProgress = - ( 2400 * thisProgress );
            gsap.set("body", { "--strokeDashoffset": scrollProgress });

            let scrollProgress2 = - parseInt( tabletVerMovement * thisProgress ) + "px";
            gsap.set("body", { "--tabletVerticaloffset": scrollProgress2 });

        }
    }

});